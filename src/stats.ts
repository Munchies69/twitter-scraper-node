import { Tweet, Reply } from "./models";
import { Op } from "sequelize";

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

export { calculateMonthlyStats, getTop5Users };