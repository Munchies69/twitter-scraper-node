import puppeteer from "puppeteer-extra";
import chromium from "@sparticuz/chromium";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import { setTimeout } from "node:timers/promises";
import {
  Tweet,
  Reply,
  TweetMetrics,
  UserMetrics,
  sequelize,
  TweetAnalysisResult,
  User,
} from "./models";
import { TweetData, analyzeMetricsWithChatGPT } from "./openai";
import { Page } from "puppeteer";
import { getQueueStatus, queueScrapeTask } from "./scrape-queue";
import { Op } from "sequelize";
import { time } from "console";

const isProduction = process.env.NODE_ENV === "production";

puppeteer.use(StealthPlugin());

const pathToUserData =
  "C:/Users/10cam/AppData/Local/Google/Chrome/User Data/Default";

async function findChromeExecutable(): Promise<string> {
  if (isProduction) {
    // In Elastic Beanstalk, we'll install Chrome during deployment
    return "/usr/bin/google-chrome-stable";
  }

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

async function launchChromeWithExtension() {
  const chromePath = await findChromeExecutable();
  const launchOptions: any = {
    executablePath: chromePath,
    headless: false, //isProduction,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };

  if (!isProduction) {
    if (!fs.existsSync(pathToUserData)) {
      fs.mkdirSync(pathToUserData);
    }
    launchOptions.userDataDir = pathToUserData;
  }

  // return await puppeteer.launch({
  //   executablePath: chromePath,
  //   // userDataDir: userDataDir,
  //   headless: false,
  //   args: [
  //     "--enable-automation",
  //     "--start-maximized",
  //   ],
  // });
  return await puppeteer.launch(launchOptions);
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

async function scrapeLocation(page: any) {
  try {
    // Use a selector that targets the specific span containing the location
    await page.waitForSelector('span[data-testid="UserLocation"]', {
      timeout: 5000,
    });
    const locationText = await page.evaluate(() => {
      const element = document.querySelector(
        'span[data-testid="UserLocation"] span span'
      );
      console.log(element);
      return element ? element.textContent : null;
    });

    console.log("Location:", locationText);
    return locationText;
  } catch (e) {
    console.log("Location not found");
    return null;
  }
}

async function scrapeTweetPage(
  page: Page,
  tweetUrl: string,
  scrapedUsername: string
): Promise<TweetData> {
  await page.goto(tweetUrl, { waitUntil: "networkidle2" });
  await setTimeout(3000);
  scrollBottomOfPage(page);

  const tweetData = await page.evaluate(() => {
    const getUserName = () => {
      const userNameElement = document.querySelector(
        '[data-testid="User-Name"]'
      );
      return userNameElement ? userNameElement.textContent?.trim() : null;
    };

    const getTweetText = () => {
      const tweetTextElement = document.querySelector(
        '[data-testid="tweetText"]'
      );
      return tweetTextElement ? tweetTextElement.textContent?.trim() : null;
    };

    const getReplies = () => {
      const replyElements = document.querySelectorAll(
        'article[data-testid="tweet"]'
      );
      return Array.from(replyElements)
        .slice(1) // Skip the first element as it's the original tweet
        .map((el) => {
          const userNameEl = el.querySelector('[data-testid="User-Name"]');
          const tweetTextEl = el.querySelector('[data-testid="tweetText"]');
          return {
            userName: userNameEl ? userNameEl.textContent?.trim() : null,
            replyText: tweetTextEl ? tweetTextEl.textContent?.trim() : null,
          };
        })
        .filter(
          (reply): reply is { userName: string; replyText: string } =>
            reply.userName !== null && reply.replyText !== null
        );
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

      const statElements = document.querySelectorAll(
        '[data-testid="app-text-transition-container"]'
      );
      statElements.forEach((el) => {
        const text = el.textContent?.trim() || "";
        const value = parseInt(text.replace(/,/g, ""), 10);
        if (el.closest('[href*="retweets"]')) stats.retweets = value;
        if (el.closest('[href*="likes"]')) stats.likes = value;
        if (el.closest('[href*="analytics"]')) stats.views = value;
      });

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

  const tweetId = tweetUrl.split("/").pop() || "";

  return {
    tweetId,
    ...tweetData,
    scrapedUsername,
  } as TweetData;
}

async function scrollBottomOfPage(page: any): Promise<void> {
  try {
    let lastHeight = await page.evaluate("document.body.scrollHeight");
    while (true) {
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      await setTimeout(3000);

      let newHeight = await page.evaluate("document.body.scrollHeight");
      if (newHeight === lastHeight) {
        break;
      }
      lastHeight = newHeight;
    }
  } catch (e) {
    console.log(e);
  }
}

async function twitterLogin(page: any, username: string, password: string) {
  try {
    // Navigate to Twitter login page
    // await page.goto("https://x.com/i/flow/login", {
    //   waitUntil: "networkidle0",
    // });

    // Enter username
    await page.waitForSelector('input[autocomplete="username"]');
    await page.type('input[autocomplete="username"]', username);

    //press tab button
    await page.keyboard.press("Tab");
    //press enter
    await page.keyboard.press("Enter");

    // Wait for password field and enter password
    await page.waitForSelector('input[name="password"]');
    await page.type('input[name="password"]', password);

    // Click the "Log in" button
    //press tab button
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    //press enter
    await page.keyboard.press("Enter");

    // Wait for navigation to complete
    await page.waitForNavigation({ waitUntil: "networkidle0" });

    console.log("Login successful");

    // Keep the browser open for demonstration purposes
    // await browser.close();
  } catch (error) {
    console.error("An error occurred during login:", error);
  }
}

async function saveCookies(page) {
  const cookies = await page.cookies();
  fs.writeFileSync("/tmp/twitter_cookies.json", JSON.stringify(cookies));
}

async function loadCookies(page) {
  if (fs.existsSync("/tmp/twitter_cookies.json")) {
    const cookiesString = fs.readFileSync("/tmp/twitter_cookies.json", "utf8");
    const cookies = JSON.parse(cookiesString);
    await page.setCookie(...cookies);
  }
}

async function isolatedScrapeUserLocation(username: string): Promise<void> {
  let browser;
  try {
    let user = await User.findOne({ where: { username } });
    if (!user) {
      user = await User.create({ username });
    }
    browser = await launchChromeWithExtension(); //await launchChromeWithExtension();
    const page = await browser.newPage();
    await navigateToProfile(page, username);
    let location = await scrapeLocation(page);
    if (location) {
      await user.update({ location });
    }
  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function extractUsername(text: string): string | null {
  // Use a regular expression to match the pattern @username
  const match = text.match(/@(\w+)/);

  // If a match is found, return the captured group (username), otherwise return null
  return match ? match[1] : null;
}

async function scrapeUserLocations(): Promise<void> {
  //get all replies
  const replies = await Reply.findAll();
  const users = await User.findAll();
  //extract all usernames
  const usernames = replies.map((reply) => extractUsername(reply.userName));
  //remove duplicates
  const uniqueUsernames = [...new Set(usernames)];
  //run isolated scrape for each username
  for (const username of uniqueUsernames) {
    //get user from db
    const user = users.find((user) => user.username === username);
    //if user already has a location, skip
    if (user?.location) {
      continue;
    }
    if (username) {
      await isolatedScrapeUserLocation(username);
      await setTimeout(3000);
    }
  }
}

async function automatedTwExportly(
  username: string,
  sendUpdate: (update: string) => void
): Promise<void> {
  let browser;
  try {
    let user = await User.findOne({ where: { username } });
    if (!user) {
      user = await User.create({ username });
    }
    const lastTweet = await Tweet.findOne({
      where: { scrapedUsername: username },
      order: [["tweetDate", "DESC"]],
    });
    //if the last tweet is less than 24 hours old, skip
    if (
      lastTweet &&
      lastTweet.tweetDate &&
      new Date().getTime() - lastTweet.tweetDate.getTime() < 86400000
    ) {
      return;
    }
    browser = await launchChromeWithExtension(); //await launchChromeWithExtension();
    const page = await browser.newPage();
    // await page.setViewport({ width: 1366, height: 768 });

    // await loadCookies(page);
    // await page.goto("https://x.com/login", { waitUntil: "networkidle0" });
    // await setTimeout(3000);

    // // Check if we're logged in
    // const isLoggedIn = await page.evaluate(() => {
    //   return document.querySelector('input[autocomplete="username"]') == null;
    // });

    // if (!isLoggedIn) {
    //   await twitterLogin(page, "munchies69@protonmail.com", ".V=1L>v@JvXtv:V-");
    //   await saveCookies(page);
    // }

    sendUpdate(`Navigating to profile of @${username}...`);

    await navigateToProfile(page, username);
    await setTimeout(10000);

    let location = await scrapeLocation(page);
    if (location) {
      await user.update({ location });
    }

    let tweetIds: string[] = [];
    let lastHeight = await page.evaluate("document.body.scrollHeight");

    const existingTweets = await Tweet.findAll({
      where: { scrapedUsername: username },
    });

    const existingTweedIds = existingTweets.map((tweet) => tweet.tweetId);
    let foundExistingTweet = false;

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
      if (
        tweetIds.some((id) => existingTweedIds.includes(id)) ||
        tweetIds.length > 50
      ) {
        foundExistingTweet = true;
        break;
      }
      lastHeight = newHeight;
    }
    //remove existing tweets from the list
    if (foundExistingTweet) {
      tweetIds = tweetIds.filter((id) => !existingTweedIds.includes(id));
    }
    sendUpdate(`Finished scrolling. Processing ${tweetIds.length} tweets...`);

    for (let i = 0; i < tweetIds.length; i++) {
      const tweetId = tweetIds[i];
      sendUpdate(`Processing tweet ${i + 1} of ${tweetIds.length}...`);

      let tweet = await Tweet.findByPk(tweetId, { include: [Reply] });

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
          // Extract the date
          let dateString;
          let isValidDate = false;
          const timeElements = await page.$$("time");

          for (let i = 0; i < timeElements.length; i++) {
            dateString = await page.evaluate(
              (el) => el.getAttribute("datetime"),
              timeElements[i]
            );

            try {
              const testDate = new Date(dateString);
              if (!isNaN(testDate.getTime())) {
                isValidDate = true;
                break;
              }
            } catch (e) {
              console.log(
                `Invalid date found: ${dateString}. Trying next element.`
              );
            }
          }
          tweetDate = new Date(dateString);
          console.log(e);
        }

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
        for (const reply of tweetData.replies) {
          await Reply.create({
            tweetId: tweetData.tweetId,
            userName: reply.userName,
            replyText: reply.replyText,
          });
        }
      }
      await analyzeTweetAndSaveMetrics(tweet.tweetId);
    }
    await validateAndUpdateTweetDates(page);
  } catch (error) {
    sendUpdate(`Error: ${error.message}`);
    console.error("An error occurred:", error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function analyzeTweetAndSaveMetrics(tweetId: string): Promise<void> {
  try {
    const tweet = await Tweet.findByPk(tweetId, {
      include: [Reply],
    });

    if (!tweet || !tweet.tweetText) {
      console.error(`Tweet with id ${tweetId} not found or had not text`);
      return;
    }

    console.log(`Analyzing tweet ${tweetId}: ${tweet.tweetText}`);

    const tweetData: TweetData = {
      tweetId: tweet.tweetId,
      userName: tweet.userName,
      tweetText: tweet.tweetText,
      replies: tweet.dataValues.replies,
      retweets: tweet.retweets,
      likes: tweet.likes,
      views: tweet.views,
      scrapedUsername: tweet.scrapedUsername,
      tweetDate: tweet?.tweetDate ? tweet.tweetDate.toISOString() : null,
    };

    const metricAnalysis = await analyzeMetricsWithChatGPT(tweetData);
    console.log(
      `Analyzing tweet ${tweetId}: ${tweet.tweetText}: ${metricAnalysis}`
    );

    if (metricAnalysis) {
      await TweetMetrics.upsert({
        tweetId: tweet.tweetId,
        ...metricAnalysis.engagementMetrics,
        ...metricAnalysis.contentStyle,
        ...metricAnalysis.sentimentAndEffectiveness,
      });
      console.log(`Metrics saved for tweet ${tweetId}`);
    } else {
      console.error(`Failed to analyze metrics for tweet ${tweetId}`);
    }
  } catch (error) {
    console.error(`Error analyzing tweet ${tweetId}:`, error);
  }
}

async function processTweetBatch(
  tweets: Tweet[],
  batchSize: number
): Promise<void> {
  for (let i = 0; i < tweets.length; i += batchSize) {
    const batch = tweets.slice(i, i + batchSize);
    await Promise.all(
      batch.map((tweet) => analyzeTweetAndSaveMetrics(tweet.tweetId))
    );
    console.log(`Processed batch ${i / batchSize + 1}`);
  }
}
export async function analyzeAllTweetsWithNoAnalysis(
  batchSize: number = 10
): Promise<void> {
  try {
    const tweetMetrics = await TweetMetrics.findAll();
    let tweetIds = tweetMetrics.map((tweetMetric) => tweetMetric.tweetId);
    const tweetsNoAnalysis = await Tweet.findAll({
      where: {
        tweetId: {
          [Op.notIn]: tweetIds,
        },
      },
    });

    console.log(`Found ${tweetsNoAnalysis.length} tweets to analyze`);

    let offset = 0;
    const limit = 20; // Fetch 100 tweets at a time to avoid memory issues

    while (offset < tweetsNoAnalysis.length) {
      const tweets = tweetsNoAnalysis.slice(offset, offset + limit);

      await processTweetBatch(tweets, batchSize);

      offset += limit;
      console.log(
        `Processed ${Math.min(offset, tweetsNoAnalysis.length)} out of ${
          tweetsNoAnalysis.length
        } tweets`
      );
    }
  } catch (error) {
    console.error("Error in analyzeAllTweets:", error);
  }
}

export async function analyzeAllTweets(batchSize: number = 10): Promise<void> {
  try {
    const totalTweets = await Tweet.count();
    console.log(`Found ${totalTweets} tweets to analyze`);

    let offset = 0;
    const limit = 100; // Fetch 100 tweets at a time to avoid memory issues

    while (offset < totalTweets) {
      const tweets = await Tweet.findAll({
        include: [Reply],
        offset,
        limit,
        order: [["tweetDate", "DESC"]], // Process newer tweets first
      });

      await processTweetBatch(tweets, batchSize);

      offset += limit;
      console.log(
        `Processed ${Math.min(
          offset,
          totalTweets
        )} out of ${totalTweets} tweets`
      );
    }

    console.log("Finished analyzing all tweets");
  } catch (error) {
    console.error("Error in analyzeAllTweets:", error);
  }
}

export async function calculateAndSaveUserMetrics(
  username: string
): Promise<void> {
  try {
    // Fetch all tweets with their metrics for the given user
    const tweets = await Tweet.findAll({
      where: { scrapedUsername: username },
      include: [{ model: TweetMetrics }],
    });

    if (tweets.length === 0) {
      console.log(`No tweets found for user ${username}`);
      return;
    }

    // Calculate average metrics
    const totalMetrics = tweets.reduce((acc, tweet) => {
      if (tweet.dataValues.tweet_metric) {
        Object.keys(tweet.dataValues.tweet_metric.dataValues).forEach((key) => {
          if (key !== "tweetId" && key !== "createdAt" && key !== "updatedAt") {
            acc[key] =
              (acc[key] || 0) + tweet.dataValues.tweet_metric.dataValues[key];
          }
        });
      }
      return acc;
    }, {});

    const averageMetrics = Object.keys(totalMetrics).reduce((acc, key) => {
      acc[key] = totalMetrics[key] / tweets.length;
      return acc;
    }, {});

    // Save or update the user metrics
    await UserMetrics.upsert({
      username,
      ...averageMetrics,
    });

    console.log(`User metrics calculated and saved for ${username}`);
  } catch (error) {
    console.error(`Error calculating user metrics for ${username}:`, error);
  }
}

async function deleteUser(username: string): Promise<void> {
  const t = await sequelize.transaction();

  try {
    // Find all tweets by the user
    const tweets = await Tweet.findAll({
      where: { scrapedUsername: username },
      transaction: t,
    });

    const tweetIds = tweets.map((tweet) => tweet.tweetId);

    await TweetAnalysisResult.destroy({
      where: { tweetId: tweetIds },
      transaction: t,
    });

    // Delete all replies associated with the user's tweets
    await Reply.destroy({
      where: { tweetId: tweetIds },
      transaction: t,
    });

    // Delete all tweet metrics associated with the user's tweets
    await TweetMetrics.destroy({
      where: { tweetId: tweetIds },
      transaction: t,
    });

    // Delete all tweets by the user
    await Tweet.destroy({
      where: { scrapedUsername: username },
      transaction: t,
    });

    // Delete user metrics
    await UserMetrics.destroy({
      where: { username },
      transaction: t,
    });

    // Commit the transaction
    await t.commit();

    console.log(
      `User ${username} and all associated data deleted successfully.`
    );
  } catch (error) {
    // If an error occurs, roll back the transaction
    await t.rollback();
    console.error(`Error deleting user ${username}:`, error);
    throw error;
  }
}

async function queueAllUsers() {
  try {
    // Fetch all unique scraped usernames from the database
    const users = await Tweet.findAll({
      attributes: ["scrapedUsername"],
      group: ["scrapedUsername"],
      raw: true,
    });

    console.log(`Found ${users.length} users to queue for scraping.`);

    for (const user of users) {
      await queueScrapeTask(user.scrapedUsername, (update) => {
        console.log(`[Scheduled ${user.scrapedUsername}]: ${update}`);
      });
    }

    console.log("Finished queueing all users for scraping.");
    console.log(getQueueStatus());
  } catch (error) {
    console.error("Error in queueAllUsers:", error);
  }
}

async function startScheduledScraping() {
  // Queue all users immediately on start
  await queueAllUsers();

  // Then queue all users every 2 hours
  setInterval(queueAllUsers, 2 * 60 * 60 * 1000);

  console.log(
    "Scheduled scraping started. Will queue all users every 2 hours."
  );
}

async function validateAndUpdateTweetDates(existingPage: Page | null = null) {
  let page = existingPage;
  let browser = null;
  if (!page) {
    browser = await launchChromeWithExtension();
    page = await browser.newPage();
  }
  try {
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 25);

    const tweets = await Tweet.findAll({
      where: {
        [Op.or]: [
          { tweetDate: null },
          { tweetDate: { [Op.lt]: tenYearsAgo } },
          { tweetDate: { [Op.gt]: new Date() } },
        ],
      },
    });

    console.log(
      `Found ${tweets.length} tweets with potentially invalid dates.`
    );

    for (const tweet of tweets) {
      try {
        console.log(
          `Processing tweet ${tweet.tweetId} ${tweet.scrapedUsername}`
        );

        // Navigate to the tweet page
        await page.goto(
          `https://twitter.com/${tweet.scrapedUsername}/status/${tweet.tweetId}`
        );
        await setTimeout(3000);

        await scrollBottomOfPage(page);
        // Wait for the date element to load
        await page.waitForSelector("time");

        // Extract the date
        let dateString;
        let isValidDate = false;
        const timeElements = await page.$$("time");

        for (let i = 0; i < timeElements.length; i++) {
          dateString = await page.evaluate(
            (el) => el.getAttribute("datetime"),
            timeElements[i]
          );

          try {
            const testDate = new Date(dateString);
            if (!isNaN(testDate.getTime())) {
              isValidDate = true;
              break;
            }
          } catch (e) {
            console.log(
              `Invalid date found: ${dateString}. Trying next element.`
            );
          }
        }

        if (dateString) {
          const newDate = new Date(dateString);

          // Validate the new date
          if (
            !isNaN(newDate.getTime()) &&
            newDate > tenYearsAgo &&
            newDate <= new Date()
          ) {
            await tweet.update({ tweetDate: newDate });
            console.log(
              `Updated date for tweet ${tweet.tweetId} to ${newDate}`
            );
          } else {
            console.log(
              `Invalid date found for tweet ${tweet.tweetId}: ${dateString}`
            );
          }
        } else {
          console.log(`No date found for tweet ${tweet.tweetId}`);
        }

        // Add a small delay to avoid rate limiting
        await setTimeout(1000);
      } catch (error) {
        console.error(`Error processing tweet ${tweet.tweetId}:`, error);
      }
    }

    console.log("Finished processing all tweets.");
  } catch (error) {
    console.error("An error occurred during tweet date validation:", error);
  } finally {
    if (browser) await browser.close();
  }
}

async function validateTweetText(existingPage: Page | null = null) {
  let page = existingPage;
  let browser = null;
  if (!page) {
    browser = await launchChromeWithExtension();
    page = await browser.newPage();
  }
  try {
    const tweets = await Tweet.findAll({
      where: {
        [Op.or]: [{ tweetText: null }],
      },
    });

    console.log(`Found ${tweets.length} tweets with null text`);

    for (const tweet of tweets) {
      try {
        console.log(
          `Processing tweet ${tweet.tweetId} ${tweet.scrapedUsername}`
        );
        const tweetUrl = `https://x.com/${tweet.scrapedUsername}/status/${tweet.tweetId}`;
        const tweetData = await scrapeTweetPage(
          page,
          tweetUrl,
          tweet.scrapedUsername
        );

        const tweetDb = await Tweet.upsert({
          tweetId: tweet.tweetId,
          userName: tweetData.userName,
          tweetText: tweetData.tweetText,
          retweets: tweetData.retweets,
          likes: tweetData.likes,
          views: tweetData.views,
          scrapedUsername: tweetData.scrapedUsername,
        });

        for (const reply of tweetData.replies) {
          await Reply.create({
            tweetId: tweetData.tweetId,
            userName: reply.userName,
            replyText: reply.replyText,
          });
        }
        await analyzeTweetAndSaveMetrics(tweet.tweetId);
      } catch (error) {
        console.error(`Error processing tweet ${tweet.tweetId}:`, error);
      }
    }

    console.log("Finished processing all tweets.");
  } catch (error) {
    console.error("An error occurred during tweet date validation:", error);
  } finally {
    if (browser) await browser.close();
  }
}

export {
  deleteUser,
  analyzeTweetAndSaveMetrics,
  automatedTwExportly,
  findChromeExecutable,
  launchChromeWithExtension,
  navigateToProfile,
  getTweetIds,
  scrapeTweetPage,
  startScheduledScraping,
  validateAndUpdateTweetDates,
  scrapeUserLocations,
  validateTweetText,
};
