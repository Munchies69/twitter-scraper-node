import { OpenAI } from "openai";
import { TweetAnalysisResult } from "./models";
import "dotenv/config";
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface TweetData {
  tweetId: string;
  userName: string;
  tweetText: string;
  replies: any[];
  retweets: number;
  likes: number;
  views: number;
  scrapedUsername: string;
  tweetDate: string;
}

export interface MetricAnalysis {
  engagementMetrics: {
    likeRatio: number;
    retweetRatio: number;
    replyRatio: number;
    viewRatio: number;
    engagementRate: number;
  };
  contentStyle: {
    informative: number;
    emotional: number;
    promotional: number;
    interactive: number;
    storytelling: number;
  };
  sentimentAndEffectiveness: {
    positivity: number;
    controversy: number;
    clarity: number;
    authenticity: number;
    timeliness: number;
  };
}

async function analyzeMetricsWithChatGPT(
  tweetData: TweetData
): Promise<MetricAnalysis | null> {
  const prompt = `
Analyze the following tweet and its replies:

Tweet: "${tweetData.tweetText}"
Retweets: ${tweetData.retweets}
Likes: ${tweetData.likes}
Views: ${tweetData.views}

Replies:
${tweetData.replies.map((reply) => `- ${reply.replyText}`).join("\n")}

Please provide an analysis of the tweet based on the following metrics. Rate each metric on a scale of 0 to 100, where 0 is the lowest and 100 is the highest.

1. Engagement Metrics:
   - Like Ratio
   - Retweet Ratio
   - Reply Ratio
   - View Ratio
   - Engagement Rate

2. Content Style:
   - Informative
   - Emotional
   - Promotional
   - Interactive
   - Storytelling

3. Sentiment and Effectiveness:
   - Positivity
   - Controversy
   - Clarity
   - Authenticity
   - Timeliness

Format your response as a JSON object with the following structure:
{
  "engagementMetrics": {
    "likeRatio": number,
    "retweetRatio": number,
    "replyRatio": number,
    "viewRatio": number,
    "engagementRate": number
  },
  "contentStyle": {
    "informative": number,
    "emotional": number,
    "promotional": number,
    "interactive": number,
    "storytelling": number
  },
  "sentimentAndEffectiveness": {
    "positivity": number,
    "controversy": number,
    "clarity": number,
    "authenticity": number,
    "timeliness": number
  }
}

Your answer must be a valid JSON string only, with no other text or custom formatting.
`;

  try {
    const chatCompletion = await openai.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-4",
    });

    const analysisResult = JSON.parse(
      chatCompletion.choices[0].message.content
    );
    return analysisResult as MetricAnalysis;
  } catch (error) {
    console.error("Error analyzing metrics with ChatGPT:", error);
    return null;
  }
}

interface TweetAnalysis {
  tweetId: string;
  engagement: string;
  sentiment: string;
  communicationStyle: string;
  effectiveness: string;
  additionalInsights: string;
  feedback: string;
}

async function analyzeTweetWithChatGPT(
  tweetData: TweetData
): Promise<TweetAnalysis | null> {
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

async function analyzeTweet(tweetData: TweetData): Promise<void> {
  const analysisData = await analyzeTweetWithChatGPT(tweetData);
  if (analysisData) {
    await TweetAnalysisResult.create({
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

async function createTweet(
  tweetTexts: string,
  username: string
): Promise<string> {
  const prompt = `Based on the following recent tweets by @${username}, generate a new tweet in their style:\n\n${tweetTexts}\n\nGenerated tweet:`;

  // Generate the tweet using OpenAI
  const chatCompletion = await openai.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "gpt-4o-mini",
  });

  const generatedTweet = chatCompletion.choices[0].message.content.trim();
  return generatedTweet;
}

async function analyzeChartScreenshot(
  screenshotBase64: string,
  symbol: string
): Promise<string | null> {
  const prompt = `Analyze this trading chart for ${symbol}. Provide a detailed technical analysis including:
1. Overall trend (bullish, bearish, or neutral)
2. Key support and resistance levels
3. Any notable patterns or formations Patterns to look for:
  Head and Shoulders
  Inverse Head and Shoulders
  Double Top
  Double Bottom
  Triple Top
  Triple Bottom
  Ascending Triangle
  Descending Triangle
  Symmetrical Triangle
  Flag
  Pennant
  Wedge (Rising and Falling)
  Cup and Handle
  Inverse Cup and Handle
  Rectangle
  Rounding Bottom (Saucer)
  Rounding Top
  Diamond Top and Bottom
  Bullish/Bearish Engulfing
  Hammer and Hanging Man
  Doji
  Morning Star and Evening Star

4. Indicators visible in the chart (e.g., moving averages, RSI, MACD)
5. Potential entry or exit points based on the technical analysis
6. Volume analysis if visible
7. Generate a short-term price prediction based on the analysis.
8. Generate a long-term price prediction based on the analysis.
9. Generate a recommendation (buy, sell, or hold) based on the analysis.
10. Any other relevant observations


Present your analysis in a structured format with clear sections for each point using markdown.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${screenshotBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 500,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Error analyzing chart screenshot with OpenAI:", error);
    return null;
  }
}

export {
  analyzeMetricsWithChatGPT,
  analyzeTweetWithChatGPT,
  analyzeTweet,
  createTweet,
  analyzeChartScreenshot,
};
