import { Sequelize, Model, DataTypes } from "sequelize";

// Sequelize setup
const sequelize = new Sequelize(
  "postgres://postgres:secret55@localhost:5432/twitter_scraper"
);

// Tweet Model
export class User extends Model {
  public username!: string;
  public location!: string;
}

User.init(
  {
    username: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    location: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  { sequelize, modelName: "user" }
);

// Tweet Model
export class Tweet extends Model {
  public tweetId!: string;
  public userName!: string;
  public tweetText!: string;
  public retweets!: number;
  public likes!: number;
  public views!: number;
  public scrapedUsername!: string;
  public tweetDate!: Date;
}

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

// Reply Model
export class Reply extends Model {
  public id!: number;
  public tweetId!: string;
  public userName!: string;
  public replyText!: string;
}

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

// TweetAnalysisResult Model
export class TweetAnalysisResult extends Model {
  public tweetId!: string;
  public engagement!: string;
  public sentiment!: string;
  public communicationStyle!: string;
  public effectiveness!: string;
  public additionalInsights!: string;
  public feedback!: string;
}

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

export class TweetMetrics extends Model {
  public tweetId!: string;
  public likeRatio!: number;
  public retweetRatio!: number;
  public replyRatio!: number;
  public viewRatio!: number;
  public engagementRate!: number;
  public informative!: number;
  public emotional!: number;
  public promotional!: number;
  public interactive!: number;
  public storytelling!: number;
  public positivity!: number;
  public controversy!: number;
  public clarity!: number;
  public authenticity!: number;
  public timeliness!: number;
}

TweetMetrics.init(
  {
    tweetId: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    likeRatio: DataTypes.FLOAT,
    retweetRatio: DataTypes.FLOAT,
    replyRatio: DataTypes.FLOAT,
    viewRatio: DataTypes.FLOAT,
    engagementRate: DataTypes.FLOAT,
    informative: DataTypes.FLOAT,
    emotional: DataTypes.FLOAT,
    promotional: DataTypes.FLOAT,
    interactive: DataTypes.FLOAT,
    storytelling: DataTypes.FLOAT,
    positivity: DataTypes.FLOAT,
    controversy: DataTypes.FLOAT,
    clarity: DataTypes.FLOAT,
    authenticity: DataTypes.FLOAT,
    timeliness: DataTypes.FLOAT,
  },
  {
    sequelize,
    modelName: "tweet_metrics",
    tableName: "tweet_metrics", // Explicitly set the table name
  }
);

export class UserMetrics extends Model {
  public username!: string;
  public likeRatio!: number;
  public replyRatio!: number;
  public retweetRatio!: number;
  public viewRatio!: number;
  public engagementRate!: number;
  public informative!: number;
  public emotional!: number;
  public promotional!: number;
  public interactive!: number;
  public storytelling!: number;
  public positivity!: number;
  public controversy!: number;
  public clarity!: number;
  public authenticity!: number;
  public timeliness!: number;
}

UserMetrics.init(
  {
    username: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    likeRatio: DataTypes.FLOAT,
    replyRatio: DataTypes.FLOAT,
    retweetRatio: DataTypes.FLOAT,
    viewRatio: DataTypes.FLOAT,
    engagementRate: DataTypes.FLOAT,
    informative: DataTypes.FLOAT,
    emotional: DataTypes.FLOAT,
    promotional: DataTypes.FLOAT,
    interactive: DataTypes.FLOAT,
    storytelling: DataTypes.FLOAT,
    positivity: DataTypes.FLOAT,
    controversy: DataTypes.FLOAT,
    clarity: DataTypes.FLOAT,
    authenticity: DataTypes.FLOAT,
    timeliness: DataTypes.FLOAT,
  },
  { sequelize, modelName: "user_metrics" }
);

// Define associations
Tweet.hasOne(TweetMetrics, { foreignKey: "tweetId" });
TweetMetrics.belongsTo(Tweet, { foreignKey: "tweetId" });

// Define associations
Tweet.hasMany(Reply, { foreignKey: "tweetId" });
Reply.belongsTo(Tweet, { foreignKey: "tweetId" });

Tweet.hasOne(TweetAnalysisResult, { foreignKey: "tweetId" });
TweetAnalysisResult.belongsTo(Tweet, { foreignKey: "tweetId" });

// Sync database
sequelize.sync({ alter: true }).then(() => {
  console.log("Database synced");
});

export { sequelize };
