import express from "express";
import path from "path";
import cors from "cors";
import { analyzeChartScreenshot, analyzeTweet, createTweet } from "./openai";
import { calculateMonthlyStats, getTop5Users } from "./stats";
import {
  Tweet,
  Reply,
  TweetAnalysisResult,
  sequelize,
  TweetMetrics,
  UserMetrics,
} from "./models";
import { Op } from "sequelize";
import {
  analyzeAllTweets,
  analyzeAllTweetsWithNoAnalysis,
  analyzeTweetAndSaveMetrics,
  automatedTwExportly,
  calculateAndSaveUserMetrics,
  deleteUser,
  scrapeUserLocations,
  startScheduledScraping,
  validateAndUpdateTweetDates,
  validateTweetText,
} from "./scraper-service";
import { queueScrapeTask } from "./scrape-queue";
import "dotenv/config";
import puppeteer from "puppeteer";
import NodeCache from "node-cache";

const cache = new NodeCache();

interface CachedAnalysis {
  analysis: string;
  timestamp: number;
}

const app = express();
const port = 3420;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend/build")));
//allow cors

// Rescrape endpoint
app.get("/api/rescrape/:username", async (req, res) => {
  const { username } = req.params;

  try {
    await queueScrapeTask(username, console.log);

    // await automatedTwExportly(username, console.log);
    res.json({ message: "Rescrape completed successfully" });
  } catch (error) {
    res.status(500).json({ message: `Error: ${error.message}` });
  }
});

// Scrape endpoint
app.get("/api/scrape/:username", (req, res) => {
  const { username } = req.params;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sendUpdate = (update: string) => {
    res.write(`data: ${JSON.stringify({ message: update })}\n\n`);
  };

  queueScrapeTask(username, sendUpdate)
    .then(async () => {
      sendUpdate("Scraping complete. Starting analysis...");

      const tweets = await Tweet.findAll({
        where: { scrapedUsername: username },
        include: [Reply],
      });

      for (const tweet of tweets) {
        const replies = await Reply.findAll({
          where: {
            tweetId: {
              [Op.eq]: tweet.tweetId,
            },
          },
        });
        await analyzeTweet({
          tweetId: tweet.tweetId,
          userName: tweet.userName,
          tweetText: tweet.tweetText,
          replies: replies,
          retweets: tweet.retweets,
          likes: tweet.likes,
          views: tweet.views,
          scrapedUsername: tweet.scrapedUsername,
          tweetDate: tweet.tweetDate.toISOString(),
        });
      }

      await calculateAndSaveUserMetrics(username);

      sendUpdate("Scraping and analysis complete!");
      res.write(
        `event: complete\ndata: ${JSON.stringify({ message: "Complete" })}\n\n`
      );
      res.end();
    })
    .catch((error) => {
      sendUpdate(`Error: ${error.message}`);
      res.end();
    });
});

// User analysis endpoint
app.get("/api/analysis/:username", async (req, res) => {
  const { username } = req.params;

  try {
    const monthlyStats = await calculateMonthlyStats(username);
    const top5Users = await getTop5Users(username);
    const tweets = await Tweet.findAll({
      where: { scrapedUsername: username },
      include: [
        { model: Reply },
        { model: TweetAnalysisResult },
        { model: TweetMetrics },
      ],
      order: [["tweetDate", "DESC"]],
    });

    res.json({ monthlyStats, top5Users, tweets });
  } catch (error) {
    console.error("Error in /:username endpoint:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/recent-tweets", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 1; // Default to 1 if not specified

    // Step 1: Get all unique usernames that have been analyzed
    const uniqueUsernames = await Tweet.findAll({
      attributes: ["scrapedUsername"],
      group: ["scrapedUsername"],
      raw: true,
    });

    // Step 2: For each username, get the most recent 'limit' tweets with their analysis
    const recentTweets = await Promise.all(
      uniqueUsernames.map(async ({ scrapedUsername }) => {
        const latestTweets = await Tweet.findAll({
          where: { scrapedUsername },
          attributes: [
            "tweetId",
            "scrapedUsername",
            "userName",
            "tweetText",
            "likes",
            "retweets",
            "views",
            "tweetDate",
          ],
          include: [
            {
              model: TweetAnalysisResult,
              attributes: ["sentiment", "effectiveness"],
              required: true,
            },
          ],
          order: [["tweetDate", "DESC"]],
          limit: limit,
          raw: true,
          nest: true,
        });

        return latestTweets;
      })
    );

    // Flatten the array of arrays into a single array of tweets
    const flattenedTweets = recentTweets.flat();

    res.json(flattenedTweets);
  } catch (error) {
    console.error("Error fetching recent tweets:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching recent tweets" });
  }
});

app.post("/api/generate-tweet/:username", async (req, res) => {
  const { username } = req.params;

  try {
    // Fetch the 10 most recent tweets
    const recentTweets = await Tweet.findAll({
      where: { scrapedUsername: username },
      order: [["tweetDate", "DESC"]],
      limit: 20,
    });

    // Prepare the prompt for OpenAI
    const tweetTexts = recentTweets
      .map((tweet) => tweet.tweetText)
      .join("\n\n");
    const generatedTweet = await createTweet(tweetTexts, username);

    res.json({ generatedTweet });
  } catch (error) {
    console.error("Error generating tweet:", error);
    res
      .status(500)
      .json({ error: "An error occurred while generating the tweet" });
  }
});

app.get("/api/analyze-metrics/:tweetId", async (req, res) => {
  const { tweetId } = req.params;

  try {
    // await analyzeTweetAndSaveMetrics(tweetId);

    const tweetMetrics = await TweetMetrics.findByPk(tweetId);

    if (tweetMetrics) {
      res.json(tweetMetrics);
    } else {
      res.status(500).json({ error: "Failed to analyze metrics" });
    }
  } catch (error) {
    console.error("Error in /api/analyze-metrics/:tweetId endpoint:", error);
    res
      .status(500)
      .json({ error: "An error occurred while analyzing metrics" });
  }
});

app.get("/api/analyze-all-tweets", async (req, res) => {
  const batchSize = req.body.batchSize || 10;

  res.json({
    message: "Bulk tweet analysis started. Check server logs for progress.",
  });

  // Run the analysis in the background
  analyzeAllTweets(batchSize)
    .then(() => {
      console.log("Bulk tweet analysis completed");
    })
    .catch((error) => {
      console.error("Error in bulk tweet analysis:", error);
    });
});

app.get("/api/user-metrics/:username", async (req, res) => {
  const { username } = req.params;

  try {
    // Try to fetch existing user metrics
    let userMetrics = await UserMetrics.findByPk(username);

    // If metrics don't exist, calculate them
    if (!userMetrics) {
      await calculateAndSaveUserMetrics(username);
      userMetrics = await UserMetrics.findByPk(username);

      // If still no metrics, the user might not have any tweets
      if (!userMetrics) {
        return res.status(404).json({
          error:
            "No metrics available for this user. They might not have any tweets.",
        });
      }
    }

    // Return the user metrics
    res.json(userMetrics);
  } catch (error) {
    console.error(`Error fetching/calculating metrics for ${username}:`, error);
    res
      .status(500)
      .json({ error: "An error occurred while processing the request" });
  }
});

app.delete("/api/user/:username", async (req, res) => {
  const { username } = req.params;
  //get password from body
  const { password } = req.body;
  if (password !== process.env.PASSWORD) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  try {
    await deleteUser(username);
    res.status(200).json({
      message: `User ${username} and all associated data deleted successfully.`,
    });
  } catch (error) {
    console.error(`Error in delete user endpoint for ${username}:`, error);
    res.status(500).json({
      error: "An error occurred while deleting the user and associated data.",
    });
  }
});

// Default core indicators
const DEFAULT_INDICATORS = [
  "RSI",
  "MACD",
  "BB", // Bollinger Bands
  "EMA50",
  "EMA200",
  "VOLUME",
];

function buildTradingViewUrl(symbol: string, indicators: string[]): string {
  let baseUrl = `https://www.tradingview.com/chart/?symbol=${symbol}`;

  const indicatorParams = indicators
    .map((indicator) => {
      switch (indicator.toUpperCase()) {
        case "RSI":
          return "studies=RSI%40tv-basicstudies";
        case "MACD":
          return "studies=MACD%40tv-basicstudies";
        case "BB":
          return "studies=BB%40tv-basicstudies";
        case "EMA50":
          return "studies=MAExp%4050";
        case "EMA200":
          return "studies=MAExp%40200";
        case "VOLUME":
          return "studies=Volume%40tv-basicstudies";
        default:
          return `studies=${encodeURIComponent(indicator)}`;
      }
    })
    .join("&");

  return `${baseUrl}&${indicatorParams}`;
}

app.get("/api/chart/screenshot/:symbol", async (req, res) => {
  const { symbol } = req.params;

  if (!symbol) {
    return res.status(400).json({ error: "Symbol is required" });
  }

  const cachedResult = cache.get(symbol) as CachedAnalysis | undefined;
  const currentTime = Date.now();

  if (cachedResult && currentTime - cachedResult.timestamp < 3600000) {
    // 1 hour in milliseconds
    return res.json({ analysis: cachedResult.analysis });
  }

  try {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800 });

    const tradingViewUrl = buildTradingViewUrl(symbol, DEFAULT_INDICATORS);

    await page.goto(tradingViewUrl, {
      waitUntil: "networkidle0",
    });

    await page.waitForSelector(".chart-markup-table");

    const screenshot = await page.screenshot({ encoding: "base64" });

    await browser.close();
    const analysis = await analyzeChartScreenshot(screenshot, symbol);

    // Cache the result
    cache.set(symbol, { analysis, timestamp: currentTime });

    res.json({
      analysis: analysis || "Analysis not available",
    });
  } catch (error) {
    console.error("Screenshot error:", error);
    res.status(500).json({ error: "Failed to capture screenshot" });
  }
});

// Catch-all route for React app
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/build", "index.html"));
});

// Error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error(err.stack);
    res.status(500).send("Something broke!");
  }
);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  // validateTweetText().then(() => {
  //   analyzeAllTweetsWithNoAnalysis();
  // });
  // startScheduledScraping();
  // validateAndUpdateTweetDates();
  // scrapeUserLocations();
});

// Start the server
// sequelize
//   .sync({ alter: true })
//   .then(() => {

//   })
//   .catch((error: Error) => {
//     console.error("Unable to connect to the database:", error);
//   });

export default app;
