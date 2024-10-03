import express from "express";
import { Sequelize, Model, DataTypes, Op } from "sequelize";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { setTimeout } from "node:timers/promises";
import axios from "axios";
import { OpenAI } from "openai";
import "dotenv/config";
import { ChartConfiguration } from "chart.js";

const forceUpdateTweetData = true;
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

puppeteer.use(StealthPlugin());

// New interface for analysis results
interface TweetAnalysis {
  tweetId: string;
  engagement: string;
  sentiment: string;
  communicationStyle: string;
  effectiveness: string;
  additionalInsights: string;
  feedback: string;
}

// Types
interface TweetData {
  tweetId: string;
  userName: string;
  tweetText: string;
  replies: Reply[];
  retweets: number;
  likes: number;
  views: number;
  scrapedUsername: string;
  tweetDate: string;
}

interface Reply {
  userName: string;
  replyText: string;
}

// Sequelize setup
const sequelize = new Sequelize(
  "postgres://postgres:secret55@localhost:5432/twitter_scraper"
);

class Tweet extends Model {}
Tweet.init(
  {
    tweetId: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    userName: DataTypes.STRING,
    tweetText: DataTypes.TEXT,
    retweets: DataTypes.INTEGER,
    likes: DataTypes.INTEGER,
    views: DataTypes.INTEGER,
    scrapedUsername: DataTypes.STRING,
    tweetDate: DataTypes.DATE,
  },
  { sequelize, modelName: "tweet" }
);

class Reply extends Model {}
Reply.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    tweetId: DataTypes.STRING,
    userName: DataTypes.STRING,
    replyText: DataTypes.TEXT,
  },
  { sequelize, modelName: "reply" }
);

// New model for storing analysis results
class TweetAnalysisResult extends Model {}
TweetAnalysisResult.init(
  {
    tweetId: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    engagement: DataTypes.TEXT,
    sentiment: DataTypes.TEXT,
    communicationStyle: DataTypes.TEXT,
    effectiveness: DataTypes.TEXT,
    additionalInsights: DataTypes.TEXT,
    feedback: DataTypes.TEXT,
  },
  { sequelize, modelName: "tweetAnalysis" }
);

Tweet.hasMany(Reply, { foreignKey: "tweetId" });
Reply.belongsTo(Tweet, { foreignKey: "tweetId" });

Tweet.hasOne(TweetAnalysisResult, { foreignKey: "tweetId" });
TweetAnalysisResult.belongsTo(Tweet, { foreignKey: "tweetId" });

// Constants
const pathToExportly =
  "C:/Users/10cam/AppData/Local/Google/Chrome/User Data/Default/Extensions/hbibehafoapglhcgfhlpifagloecmhfh/2.21_0";
const pathToUserData =
  "C:/Users/10cam/AppData/Local/Google/Chrome/User Data/Default";

// Functions
async function findChromeExecutable(): Promise<string> {
  const commonPaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];

  for (const path of commonPaths) {
    if (fs.existsSync(path)) {
      return path;
    }
  }

  throw new Error(
    "Chrome executable not found. Please specify the path manually."
  );
}

async function analyzeTweetWithChatGPT(
  tweetData: TweetData
): Promise<TweetAnalysis> {
  const prompt = `
Analyze the following tweet and its replies:

Tweet: "${tweetData.tweetText}"
Retweets: ${tweetData.retweets}
Likes: ${tweetData.likes}
Views: ${tweetData.views}

Replies:
${tweetData.replies.map((reply) => `- ${reply.replyText}`).join("\n")}

Please provide a comprehensive analysis covering the following points:
1. Engagement: Assess the level of engagement based on retweets, likes, and views.
2. Sentiment: Analyze the overall sentiment of the tweet and replies.
3. Communication Style: Evaluate the communication style used in the tweet.
4. Effectiveness: Determine how effective the tweet is in conveying its message.
5. Additional Insights: Provide any other relevant observations or insights.
6. Feedback: Offer constructive feedback or suggestions for improvement.

Format your response as a JSON object with the following keys: engagement, sentiment, communicationStyle, effectiveness, additionalInsights, feedback.
Each property in the JSON object must be a string.
Your answer must be in a JSON parseable string only with no other text or custom formatting.
`;

  try {
    const chatCompletion = await openai.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-4o-mini",
    });

    const analysisResult = JSON.parse(
      chatCompletion.choices[0].message.content
    );
    return {
      tweetId: tweetData.tweetId,
      ...analysisResult,
    };
  } catch (error) {
    console.error("Error analyzing tweet with ChatGPT:", error);
    return null;
  }
}

async function launchChromeWithExtension() {
  const chromePath = await findChromeExecutable();
  const userDataDir = pathToUserData;
  const extensionPath = pathToExportly;
  // const proxyServer = 'http://138.68.235.51:port'; // Replace with an actual free proxy
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir);
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    userDataDir: userDataDir,
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--enable-automation",
      "--start-maximized",
      // `--proxy-server=${proxyServer}`,
    ],
  });

  return browser;
}

async function navigateToProfile(
  page: any,
  username: string,
  timeout = 30000
): Promise<boolean> {
  await page.goto(`https://twitter.com/${username}`, {
    waitUntil: "domcontentloaded",
  });

  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      await page.waitForSelector('div[data-testid="primaryColumn"]', {
        timeout: 5000,
      });
      return true;
    } catch (e) {
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    await setTimeout(1000);
  }
  throw new Error("Profile navigation timeout");
}

async function getTweetIds(page: any): Promise<string[]> {
  return await page.evaluate(() => {
    const tweetElements = document.querySelectorAll(
      'article[data-testid="tweet"]'
    );
    return Array.from(tweetElements)
      .map((el) => {
        const link: any = el.querySelector('a[href*="/status/"]');
        return link ? link.href.split("/status/")[1] : null;
      })
      .filter((id): id is string => id !== null);
  });
}

async function scrapeTweetPage(
  page: any,
  tweetUrl: string,
  scrapedUsername: string
): Promise<TweetData> {
  await page.goto(tweetUrl, { waitUntil: "networkidle2" });

  const tweetData = await page.evaluate(() => {
    const getUserName = () => {
      const userNameElement = document.querySelector(
        '[data-testid="User-Name"]'
      );
      return userNameElement ? userNameElement.textContent : null;
    };

    const getTweetText = () => {
      const tweetTextElement = document.querySelector(
        '[data-testid="tweetText"]'
      );
      return tweetTextElement ? tweetTextElement.textContent : null;
    };

    const getReplies = () => {
      const replyElements = document.querySelectorAll(
        'article[data-testid="tweet"]'
      );
      return Array.from(replyElements)
        .map((el) => {
          const userNameEl = el.querySelector('[data-testid="User-Name"]');
          const tweetTextEl = el.querySelector('[data-testid="tweetText"]');
          return {
            userName: userNameEl ? userNameEl.textContent : null,
            replyText: tweetTextEl ? tweetTextEl.textContent : null,
          };
        })
        .filter(
          (reply): reply is Reply =>
            reply.userName !== null && reply.replyText !== null
        )
        .slice(1);
    };

    const getTweetDate = () => {
      const timeElement = document.querySelector("time");
      return timeElement ? timeElement.getAttribute("datetime") : null;
    };

    const getStats = () => {
      const stats = {
        retweets: 0,
        likes: 0,
        views: 0,
      };

      // Retweets
      const retweetElement = document.querySelector(
        '[data-testid="unretweet"], [data-testid="retweet"]'
      );
      if (retweetElement) {
        const retweetText = retweetElement.textContent;
        stats.retweets = parseInt(retweetText?.match(/\d+/)?.[0] || "0", 10);
      }

      // Likes
      const likeElement = document.querySelector(
        '[data-testid="unlike"], [data-testid="like"]'
      );
      if (likeElement) {
        const likeText = likeElement.textContent;
        stats.likes = parseInt(likeText?.match(/\d+/)?.[0] || "0", 10);
      }

      // Views
      const viewElement = document.querySelector('a[href$="/analytics"]');
      if (viewElement) {
        const viewText = viewElement.textContent;
        const viewMatch = viewText?.match(/(\d+(?:\.\d+)?)(K|M)?/);
        if (viewMatch) {
          let viewCount = parseFloat(viewMatch[1]);
          if (viewMatch[2] === "K") viewCount *= 1000;
          if (viewMatch[2] === "M") viewCount *= 1000000;
          stats.views = Math.round(viewCount);
        }
      }

      return stats;
    };

    return {
      userName: getUserName(),
      tweetText: getTweetText(),
      replies: getReplies(),
      tweetDate: getTweetDate(),
      ...getStats(),
    };
  });

  return {
    tweetId: tweetUrl.split("/status/")[1],
    ...tweetData,
    scrapedUsername,
  };
}

function generateTweetHtml(tweet: any, replies: any[], analysis: any): string {
  const replyHtml = replies
    .map(
      (reply) => `
    <div class="mt-2 p-3 bg-gray-100 rounded-lg">
      <p class="text-sm text-gray-600">${reply.userName}</p>
      <p>${reply.replyText}</p>
    </div>
  `
    )
    .join("");
  const tweetDate = new Date(tweet.tweetDate).toLocaleString();

  let mentionedProfiles: string[] = [];
  if (tweet.tweetText) {
    //get any mentioned profiles in the tweet text or in replies like @AureliusFi
    mentionedProfiles = tweet.tweetText.match(/@[a-zA-Z0-9_]+/g) || [];
  }
  replies.forEach((reply) => {
    const mentionedProfilesInReply: string =
      reply.replyText.match(/@[a-zA-Z0-9_]+/g) || [];
    mentionedProfiles.push(...mentionedProfilesInReply);
  });
  //dedup mentioned profiles
  const uniqueMentionedProfiles = [...new Set(mentionedProfiles)];

  //create list of mentioned profiles as a link that take users to /@mentionedProfile page
  const mentionedProfilesHtml = uniqueMentionedProfiles
    .map((profile) => {
      const profileName = profile.substring(1); //remove @
      return `<a class="m-2 text-sm text-blue-500" href="/${profileName}">${profile}</a>`;
    })
    .join(" | ");

  return `
    <div class="mb-8 p-6 bg-white rounded-lg shadow-md">
      <div class="flex flex-col lg:flex-row">
        <div class="w-full lg:w-2/3 lg:pr-6">
          <div class="flex items-center mb-4">
            <img src="https://via.placeholder.com/40" alt="Profile" class="w-10 h-10 rounded-full mr-4">
            <div>
              <h2 class="font-bold">${tweet?.userName}</h2>
              <p class="text-sm text-gray-500">@${tweet?.scrapedUsername}</p>
            </div>
          </div>
          <p class="mb-2 text-sm text-gray-500">Posted on: ${tweetDate}</p>
          <p class="mb-4">${tweet?.tweetText}</p>
          <div class="flex flex-wrap items-center justify-start text-sm mb-4">Mentions: ${mentionedProfilesHtml}</div>
          <div class="flex space-x-4 text-sm text-gray-500 mb-4">
            <span>${tweet?.retweets} Retweets</span>
            <span>${tweet?.likes} Likes</span>
            <span>${tweet?.views} Views</span>
          </div>
          <div class="mt-4">
            <h3 class="font-bold mb-2">Replies</h3>
            ${replyHtml}
          </div>
        </div>
        <div class="w-full lg:w-1/3 mt-6 lg:mt-0">
          <div class="p-4 bg-blue-50 rounded-lg">
            <h3 class="font-bold mb-2">Analysis</h3>
            <p><strong>Engagement:</strong> ${analysis?.engagement || "N/A"}</p>
            <p><strong>Sentiment:</strong> ${analysis?.sentiment || "N/A"}</p>
            <p><strong>Communication Style:</strong> ${
              analysis?.communicationStyle || "N/A"
            }</p>
            <p><strong>Effectiveness:</strong> ${
              analysis?.effectiveness || "N/A"
            }</p>
            <p><strong>Additional Insights:</strong> ${
              analysis?.additionalInsights || "N/A"
            }</p>
            <p><strong>Feedback:</strong> ${analysis?.feedback || "N/A"}</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Function to generate the full HTML page
function generateHtmlPage(username: string, tweetsHtml: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Twitter Analysis for @${username}</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-100">
      <div class="container mx-auto px-4 py-8">
        <h1 class="text-3xl font-bold mb-8">Twitter Analysis for @${username}</h1>
        ${tweetsHtml}
      </div>
    </body>
    </html>
  `;
}

// Updated automatedTwExportly function
async function automatedTwExportly(
  username: string,
  sendUpdate: (update: string) => void
): Promise<string> {
  let browser;
  try {
    browser = await launchChromeWithExtension();
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    sendUpdate(`Navigating to profile of @${username}...`);

    await navigateToProfile(page, username);

    let tweetIds: string[] = [];
    let lastHeight = await page.evaluate("document.body.scrollHeight");

    while (true) {
      const newIds = await getTweetIds(page);
      tweetIds = [...new Set([...tweetIds, ...newIds])];
      sendUpdate(`Found ${tweetIds.length} tweets so far...`);

      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      await setTimeout(3000);

      let newHeight = await page.evaluate("document.body.scrollHeight");
      if (newHeight === lastHeight) {
        break;
      }
      lastHeight = newHeight;
    }
    sendUpdate(`Finished scrolling. Processing ${tweetIds.length} tweets...`);

    console.log(`Found ${tweetIds.length} tweets`);
    if (tweetIds.length === 0) {
      let tweets = await Tweet.findAll({
        where: { scrapedUsername: username },
      });
      tweetIds = tweets.map((tweet) => tweet.dataValues.tweetId);
    }

    for (let i = 0; i < tweetIds.length; i++) {
      const tweetId = tweetIds[i];
      sendUpdate(`Processing tweet ${i + 1} of ${tweetIds.length}...`);

      let tweet = await Tweet.findByPk(tweetId, { include: [Reply] });

      let analysis = await TweetAnalysisResult.findByPk(tweetId);
      let replies = await Reply.findAll({ where: { tweetId } });
      if (!tweet) {
        const tweetUrl = `https://x.com/${username}/status/${tweetId}`;
        const tweetData = await scrapeTweetPage(page, tweetUrl, username);

        let tweetDate = null;
        try {
          tweetDate = new Date(tweetData.tweetDate);
          if (tweetDate == "Invalid Date") {
            tweetDate = null;
          }
        } catch (e) {
          console.log(e);
        }

        if (!tweet)
          tweet = await Tweet.create({
            tweetId: tweetData.tweetId,
            userName: tweetData.userName,
            tweetText: tweetData.tweetText,
            retweets: tweetData.retweets,
            likes: tweetData.likes,
            views: tweetData.views,
            scrapedUsername: tweetData.scrapedUsername,
            tweetDate: tweetDate,
          });
        else {
          await Tweet.upsert({
            tweetId: tweetData.tweetId,
            userName: tweetData.userName,
            tweetText: tweetData.tweetText,
            retweets: tweetData.retweets,
            likes: tweetData.likes,
            views: tweetData.views,
            scrapedUsername: tweetData.scrapedUsername,
            tweetDate: tweetDate,
          });
          await setTimeout(4000);
        }

        for (const reply of tweetData.replies) {
          await Reply.create({
            tweetId: tweetData.tweetId,
            userName: reply.userName,
            replyText: reply.replyText,
          });
        }
      }

      if (!analysis) {
        sendUpdate(`Analyzing tweet ${i + 1} with ChatGPT...`);
        let data = tweet.dataValues;

        let tweetData: TweetData = {
          tweetId: data.tweetId,
          userName: data.userName,
          tweetText: data.tweetText,
          replies: replies,
          retweets: data.retweets,
          likes: data.likes,
          views: data.views,
          scrapedUsername: data.scrapedUsername,
          tweetDate: data.tweetDate,
        };
        let analysisData: TweetAnalysis = await analyzeTweetWithChatGPT(
          tweetData
        );
        if (analysisData) {
          analysis = await TweetAnalysisResult.create({
            tweetId: analysisData.tweetId,
            engagement: analysisData.engagement,
            sentiment: analysisData.sentiment,
            communicationStyle: analysisData.communicationStyle,
            effectiveness: analysisData.effectiveness,
            additionalInsights: analysisData.additionalInsights,
            feedback: analysisData.feedback,
          });
        }
      }
    }
  } catch (error) {
    sendUpdate(`Error: ${error.message}`);
    console.error("An error occurred:", error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  sendUpdate("Generating HTML...");

  let tweets = await Tweet.findAll({
    where: { scrapedUsername: username },
  });
  let promises = tweets.map(async (tweet) => {
    let analysis = await TweetAnalysisResult.findByPk(tweet.dataValues.tweetId);
    let replies = await Reply.findAll({
      where: { tweetId: tweet.dataValues.tweetId },
    });
    return { tweet, replies, analysis };
  });
  const tweetDataList = await Promise.all(promises);

  const tweetsHtml = tweetDataList
    .map(({ tweet, replies, analysis }) =>
      generateTweetHtml(tweet, replies, analysis)
    )
    .join("");

  return generateHtmlPage(username, tweetsHtml);
}


function areUsernamesSimilar(
  scrapedUsername: string,
  userName: string
): boolean {
  if (!scrapedUsername || !userName) return false;
  const normalizeUsername = (username: string) =>
    username.toLowerCase().replace(/[^a-z0-9]/g, "");

  const normalizedScraped = normalizeUsername(scrapedUsername);
  const normalizedUser = normalizeUsername(userName.split("@")[1] || userName);

  return (
    normalizedScraped.includes(normalizedUser) ||
    normalizedUser.includes(normalizedScraped)
  );
}

// New function to calculate monthly statistics

// Updated function to calculate monthly statistics
async function calculateMonthlyStats(username: string) {
  const tweets = await Tweet.findAll({
    where: { scrapedUsername: username },
    include: [Reply],
  });

  const monthlyStats = tweets.reduce((acc, tweet) => {
    const date = new Date(tweet.dataValues.tweetDate);
    const monthYear = `${date.getFullYear()}-${date.getMonth() + 1}`;

    if (!acc[monthYear]) {
      acc[monthYear] = {
        tweets: 0,
        originalTweets: 0,
        retweets: 0,
        views: 0,
        likes: 0,
        replies: 0,
      };
    }

    acc[monthYear].tweets++;

    const isOriginalTweet = areUsernamesSimilar(
      tweet.dataValues.scrapedUsername,
      tweet.dataValues.userName
    );

    if (isOriginalTweet) {
      acc[monthYear].originalTweets++;
      acc[monthYear].views += tweet.dataValues.views;
    } else {
      acc[monthYear].retweets++;
    }

    acc[monthYear].likes += tweet.dataValues.likes;
    acc[monthYear].replies += tweet.dataValues.replies.length;

    return acc;
  }, {});

  return monthlyStats;
}
// Function to get top 5 users who replied
async function getTop5Users(username: string) {
  const replies = await Reply.findAll({
    include: [
      {
        model: Tweet,
        where: { scrapedUsername: username },
        attributes: ["scrapedUsername"],
      },
    ],
    where: {
      userName: {
        [Op.notLike]: `%${username}%`,
      },
    },
  });

  const userCounts = replies.reduce((acc, reply) => {
    const replyUsername = reply.dataValues.userName;
    acc[replyUsername] = (acc[replyUsername] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(userCounts)
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 5);
}
function sortDates(dates: string[]): string[] {
  return dates.sort((a, b) => {
    const [yearA, monthA] = a.split("-").map(Number);
    const [yearB, monthB] = b.split("-").map(Number);
    return yearA !== yearB ? yearA - yearB : monthA - monthB;
  });
}
// Updated function to generate chart configurations
function generateChartConfigs(monthlyStats, top5Users) {
  const months = Object.keys(monthlyStats);
  const originalTweetCounts = months.map(
    (month) => monthlyStats[month].originalTweets
  );
  const retweetCounts = months.map((month) => monthlyStats[month].retweets);
  const viewCounts = months.map((month) => monthlyStats[month].views);

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  const tweetChartConfig: ChartConfiguration = {
    type: "line",
    data: {
      labels: months,
      datasets: [
        {
          label: "Original Tweets per Month",
          data: originalTweetCounts,
          borderColor: "rgb(75, 192, 192)",
          tension: 0.1,
        },
        {
          label: "Retweets per Month",
          data: retweetCounts,
          borderColor: "rgb(255, 159, 64)",
          tension: 0.1,
        },
      ],
    },
    options: commonOptions,
  };

  const viewChartConfig: ChartConfiguration = {
    type: "line",
    data: {
      labels: months,
      datasets: [
        {
          label: "Views per Month (Original Tweets Only)",
          data: viewCounts,
          borderColor: "rgb(255, 99, 132)",
          tension: 0.1,
        },
      ],
    },
    options: commonOptions,
  };

  const userChartConfig: ChartConfiguration = {
    type: "bar",
    data: {
      labels: top5Users.map((user) => user[0]),
      datasets: [
        {
          label: "Top 5 Users by Reply Count",
          data: top5Users.map((user) => user[1]),
          backgroundColor: "rgb(54, 162, 235)",
        },
      ],
    },
    options: commonOptions,
  };

  return { tweetChartConfig, viewChartConfig, userChartConfig };
}

// Function to generate HTML for analysis page
function generateAnalysisHTML(username, monthlyStats, top5Users, tweets) {
  const tweetsHtml = tweets
    .map((tweet) =>
      generateTweetHtml(tweet, tweet.replies, tweet.tweetAnalysis)
    )
    .join("");
  const {
    tweetChartConfig,
    viewChartConfig,
    userChartConfig,
  } = generateChartConfigs(monthlyStats, top5Users);

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Twitter Analysis for @${username}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <style>
        .chart-container {
          height: 300px;
          position: relative;
        }
      </style>
    </head>
    <body class="bg-gray-100">
      <div class="container mx-auto px-4 py-8">
        <h1 class="text-3xl font-bold mb-8">Twitter Analysis for @${username}</h1>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div>
            <h2 class="text-xl font-bold mb-4">Monthly Tweet Count</h2>
            <div class="chart-container">
              <canvas id="tweetChart"></canvas>
            </div>
          </div>
          <div>
            <h2 class="text-xl font-bold mb-4">Monthly View Count</h2>
            <div class="chart-container">
              <canvas id="viewChart"></canvas>
            </div>
          </div>
        </div>
        
        <div class="mb-8">
          <h2 class="text-xl font-bold mb-4">Top 5 Users by Reply Count</h2>
          <div class="chart-container">
            <canvas id="userChart"></canvas>
          </div>
        </div>

        <button id="rescrapeButton" class="bg-green-500 text-white px-4 py-2 rounded mb-8">Rescrape @${username}</button>

        <div id="tweetsContainer">
          ${tweetsHtml}
        </div>
      </div>

      <script>
        const tweetChartConfig = ${JSON.stringify(tweetChartConfig)};
        const viewChartConfig = ${JSON.stringify(viewChartConfig)};
        const userChartConfig = ${JSON.stringify(userChartConfig)};

        new Chart(document.getElementById('tweetChart'), tweetChartConfig);
        new Chart(document.getElementById('viewChart'), viewChartConfig);
        new Chart(document.getElementById('userChart'), userChartConfig);

        document.getElementById('rescrapeButton').addEventListener('click', () => {
          fetch('/scrape/${username}', { method: 'POST' })
            .then(response => response.json())
            .then(data => {
              alert(data.message);
              location.reload();
            })
            .catch(error => {
              alert('Error: ' + error.message);
            });
        });
      </script>
    </body>
    </html>
  `;
}

// Express server setup
const app = express();
// app.use(express.static("public"));
app.use(express.static(path.join(__dirname, '../frontend/build')));

const port = 3420;

app.get("/scrape/:username", (req, res) => {
  const { username } = req.params;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sendUpdate = (update: string) => {
    res.write(`data: ${JSON.stringify({ message: update })}\n\n`);
  };

  automatedTwExportly(username, sendUpdate)
    .then((htmlContent) => {
      sendUpdate("Scraping and analysis complete!");
      res.write(
        `event: complete\ndata: ${JSON.stringify({ html: htmlContent })}\n\n`
      );
      res.end();
    })
    .catch((error) => {
      sendUpdate(`Error: ${error.message}`);
      res.end();
    });
});


// New endpoint for user analysis
app.get("/:username", async (req, res) => {
  const { username } = req.params;

  try {
    const monthlyStats = await calculateMonthlyStats(username);
    const top5Users = await getTop5Users(username);
    const tweets = await Tweet.findAll({
      where: { scrapedUsername: username },
      include: [{ model: Reply }, { model: TweetAnalysisResult }],
      order: [["tweetDate", "DESC"]],
    });

    //sort tweets by date in ascending order

    const htmlContent = generateAnalysisHTML(
      username,
      monthlyStats,
      top5Users,
      tweets
    );
    res.send(htmlContent);
  } catch (error) {
    console.error("Error in /:username endpoint:", error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

// New endpoint for rescraping
app.post("/scrape/:username", async (req, res) => {
  const { username } = req.params;

  try {
    // Call your scraping function here
    await automatedTwExportly(username, console.log);
    res.json({ message: "Rescrape completed successfully" });
  } catch (error) {
    res.status(500).json({ message: `Error: ${error.message}` });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/build', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// Sync database
sequelize.sync({ alter: true }).then(() => {
  console.log("Database synced");
});
