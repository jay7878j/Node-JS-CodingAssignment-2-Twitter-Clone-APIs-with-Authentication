const express = require("express");
const { open } = require("sqlite");
const sqlite = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const dbPath = path.join(__dirname, "twitterClone.db");
app.use(express.json());
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite.Database,
    });
    app.listen(3000, () => {
      console.log("Server Started");
    });
  } catch (error) {
    console.log(`DB error: ${error.message}`);
  }
};

initializeDBAndServer();

// Authorization with JWT Token
const authenticateToken = async (request, response, next) => {
  let jwtToken;
  const authenticateHeaders = request.headers["authorization"];
  if (authenticateHeaders !== undefined) {
    jwtToken = authenticateHeaders.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET_TOKEN", (error, payLoad) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.userId = payLoad.user_id;
        next();
      }
    });
  }
};

const userFollowingIdsList = async (request, response, next) => {
  const followingQuery = `
                SELECT 
                following_user_id
            FROM
                follower
            WHERE 
                follower_user_id = ${request.userId}
    `;
  const data = await db.all(followingQuery);
  const userFollowingIds = data.map((each) => each.following_user_id);
  console.log(userFollowingIds);
  request.userFollowingIds = userFollowingIds;
  next();
};

app.get("/check", async (req, res) => {
  const { name } = req.query;
  const sqlQuery = `SELECT * FROM ${name}`;
  const responseData = await db.all(sqlQuery);
  res.send(responseData);
});

// API 1 New user Registration
app.post("/register", async (request, response) => {
  const { username, password, name, gender } = request.body;

  //   Query for checking whether the user already in or not
  const userCheckQuery = `
    SELECT * FROM user WHERE username = "${username}";
    `;
  const dbUser = await db.get(userCheckQuery);

  if (dbUser === undefined) {
    if (password.length > 6) {
      const hashedPassword = await bcrypt.hash(password, 10);

      const createUserQuery = `
            INSERT INTO 
                user(username, password, name, gender)
            VALUES
                ("${username}", "${hashedPassword}", "${name}", "${gender}")
            `;

      await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// API 2 User Login
app.post("/login", async (request, response) => {
  const { username, password } = request.body;

  //   Query for checking whether the user already in or not
  const userCheckQuery = `
    SELECT * FROM user WHERE username = "${username}";
    `;
  const dbUser = await db.get(userCheckQuery);

  if (dbUser !== undefined) {
    const passwordCheck = await bcrypt.compare(password, dbUser.password);
    if (passwordCheck) {
      const payLoad = {
        username: username,
        user_id: dbUser.user_id,
      };
      const jwtToken = jwt.sign(payLoad, "SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

// API 3 Latest tweets of people whom the user follows
app.get(
  "/user/tweets/feed/",
  authenticateToken,
  userFollowingIdsList,
  async (request, response) => {
    const tweetsQuery = `
      SELECT
          user.username as username,
          tweet.tweet as tweet,
          tweet.date_time as dateTime
      FROM
          tweet INNER JOIN user on tweet.user_id = user.user_id
      WHERE
          tweet.user_id IN (${request.userFollowingIds})
      ORDER BY
          tweet.date_time DESC
      LIMIT 4;
      `;
    const responseData = await db.all(tweetsQuery);
    response.send(responseData);
  }
);

// API 4 Get all names of people whom the user follows
app.get("/user/following/", authenticateToken, async (request, response) => {
  const getUserFollowsQuery = `
    SELECT
        name
    FROM
        user
    WHERE
        user.user_id IN (
            SELECT 
                following_user_id
            FROM
                follower
            WHERE 
                follower_user_id = ${request.userId}
        );
    `;
  const responseData = await db.all(getUserFollowsQuery);
  response.send(responseData);
});

// API 5 Get followers names of the user
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const getFollowersQuery = `
    SELECT 
        name
    FROM
        user
    WHERE
        user_id IN (
            SELECT 
                follower_user_id
            FROM
                follower
            WHERE
                following_user_id = ${request.userId}
        )
    `;
  const responseData = await db.all(getFollowersQuery);
  response.send(responseData);
});

// API 6 Get user requested tweet info
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  userFollowingIdsList,
  async (request, response) => {
    const { tweetId } = request.params;

    const userReqTweetQuery = `
    SELECT tweet_id FROM tweet WHERE user_id IN (${request.userFollowingIds})
    `;
    const reqTweetData = await db.all(userReqTweetQuery);
    const userFollowingTweetsIdList = reqTweetData.map((each) => each.tweet_id);
    const tweetIdCheck = userFollowingTweetsIdList.includes(parseInt(tweetId));
    //   console.log(userFollowingTweetsIdList, tweetIdCheck);

    if (tweetIdCheck) {
      const tweetInfoQuery = `
    SELECT
        tweet,
        (SELECT count(*) FROM like WHERE tweet_id = ${tweetId}) as likes,
        (SELECT count(*) FROM reply WHERE tweet_id = ${tweetId}) as replies,
        date_time as dateTime
    FROM
        tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
        INNER JOIN like on tweet.tweet_id = like.tweet_id
    WHERE
        tweet.tweet_id = ${tweetId}
    `;
      const responseData = await db.get(tweetInfoQuery);
      response.send(responseData);
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

// API 7 Get who liked the user requested tweet
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  userFollowingIdsList,
  async (request, response) => {
    const { tweetId } = request.params;

    const userReqTweetQuery = `
    SELECT tweet_id FROM tweet WHERE user_id IN (${request.userFollowingIds})
    `;

    const reqTweetData = await db.all(userReqTweetQuery);
    const userFollowingTweetsIdList = reqTweetData.map((each) => each.tweet_id);
    const tweetIdCheck = userFollowingTweetsIdList.includes(parseInt(tweetId));
    console.log(userFollowingTweetsIdList, tweetIdCheck);

    if (tweetIdCheck) {
      const getWhoTweetLikesQuery = `
            SELECT username FROM user INNER JOIN like on like.user_id = user.user_id
            WHERE like.tweet_id = ${tweetId}
            `;
      const tweetLikedNamesData = await db.all(getWhoTweetLikesQuery);
      response.send({
        likes: tweetLikedNamesData.map((each) => each.username),
      });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

// API 8 Get who replied the user requested tweet
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  userFollowingIdsList,
  async (request, response) => {
    const { tweetId } = request.params;

    const userReqTweetQuery = `
    SELECT tweet_id FROM tweet WHERE user_id IN (${request.userFollowingIds})
    `;
    const reqTweetData = await db.all(userReqTweetQuery);
    const userFollowingTweetsIdList = reqTweetData.map((each) => each.tweet_id);
    const tweetIdCheck = userFollowingTweetsIdList.includes(parseInt(tweetId));
    //   console.log(userFollowingTweetsIdList, tweetIdCheck);

    if (tweetIdCheck) {
      const getWhoTweetReplyQuery = `
            SELECT name,reply FROM user INNER JOIN reply on reply.user_id = user.user_id
            WHERE reply.tweet_id = ${tweetId}
            `;
      const tweetRepliedData = await db.all(getWhoTweetReplyQuery);
      response.send({ replies: tweetRepliedData });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

// API 9 Get all user tweets
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const getUserTweetsQuery = `
    select 
        tweet,
        count (distinct like_id) as likes,
        count (distinct reply_id) as replies,
        date_time as dateTime
    from
        tweet 
        left join like on like.tweet_id = tweet.tweet_id
        left join reply on reply.tweet_id = tweet.tweet_id
    where 
        tweet.user_id = ${request.userId}
    GROUP BY
        tweet.tweet_id
  `;
  const userTweetsData = await db.all(getUserTweetsQuery);
  response.send(userTweetsData);
});

// API 10 Create a new tweet
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;

  const createTweetQuery = `
    INSERT INTO
        tweet(tweet)
    VALUES
        ("${tweet}")
    `;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

// API 11 Delete tweet
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;

    const userTweetsQuery = `
    SELECT tweet_id FROM tweet WHERE user_id = ${request.userId}
    `;
    const tweetsData = await db.all(userTweetsQuery);
    const tweetIdsList = tweetsData.map((each) => each.tweet_id);
    console.log(tweetIdsList);

    const tweetIdCheck = tweetIdsList.includes(parseInt(tweetId));

    if (tweetIdCheck) {
      const deleteTweetQuery = `
        DELETE FROM
            tweet
        WHERE 
            tweet_id = ${tweetId}
        `;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
