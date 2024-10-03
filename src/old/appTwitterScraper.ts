import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const TWITTER_API_BASE_URL = 'https://api.twitter.com/2';
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;

interface Tweet {
  id: string;
  text: string;
  created_at: string;
}

async function getUserIdByUsername(username: string): Promise<string> {
  const response = await axios.get(`${TWITTER_API_BASE_URL}/users/by/username/${username}`, {
    headers: {
      'Authorization': `Bearer ${TWITTER_BEARER_TOKEN}`
    }
  });
  return response.data.data.id;
}

async function getUserTweets(userId: string, maxResults: number = 10): Promise<Tweet[]> {
    const response = await axios.get(`${TWITTER_API_BASE_URL}/users/${userId}/tweets`, {
        headers: {
            'Authorization': `Bearer ${TWITTER_BEARER_TOKEN}`
        },
        params: {
            max_results: maxResults,
            'tweet.fields': 'created_at'
        }
    });
    return response.data.data;
}

async function main() {
  try {
    const username = 'elonmusk'; // Replace with the desired username
    const userId = await getUserIdByUsername(username);
    const tweets = await getUserTweets(userId, 20);
    
    console.log(`Latest tweets from ${username}:`);
    tweets.forEach((tweet: Tweet) => {
      console.log(`[${tweet.created_at}] ${tweet.text}`);
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

main();