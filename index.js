const express = require("express");
const app = express();
const methodOverride = require("method-override");

app.use(methodOverride("_method"));
app.use(express.static(__dirname + "/public")); //public 폴더 안의 파일들을 등록
app.set("view engine", "ejs");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 몽고db연결
const { MongoClient, ObjectId } = require("mongodb");

let db;
const url =
  "mongodb+srv://doulzang:aa41374311!@cluster0.3ukktp9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
new MongoClient(url)
  .connect()
  .then((client) => {
    console.log("DB연결성공");
    db = client.db("unit_test");
    app.listen(8080, () => {
      console.log("http://localhost:8080 에서 서버 실행중");
    });
  })
  .catch((err) => {
    console.log(err);
  });
// 몽고db연결

app.get("/", function (req, res) {
  res.sendFile(__dirname + "/index.html");
});

app.get("/code", function (req, res) {
  res.render("code.ejs"); // EJS 파일을 렌더링합니다. '.ejs' 확장자는 생략 가능합니다.
});

app.post("/verify-code", async (req, res) => {
  const { code } = req.body;
  try {
    const result = await db.collection("responses").findOne({ code: code });
    if (result) {
      res.json({ valid: true });
    } else {
      res.json({ valid: false });
    }
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// app.get("/test", function (req, res) {
//   const code = req.query.code; // URL에서 code 파라미터를 가져옵니다.
//   res.render("test", { code: code }); // test.ejs 파일을 렌더링하면서 code 변수를 전달
// });

app.get("/test", async (req, res) => {
  const code = req.query.code; // URL에서 code 파라미터를 가져옵니다.

  // 코드가 제공되지 않은 경우 바로 테스트 페이지 렌더링
  if (!code) {
    res.render("test", { code: undefined });
    return;
  }

  // 제공된 코드의 유효성 검사
  try {
    const result = await db.collection("responses").findOne({ code: code });
    if (result) {
      // 코드가 유효하면 test 페이지 렌더링
      res.render("test", { code: code });
    } else {
      // 코드가 유효하지 않으면 404 에러 페이지로 리다이렉션
      res.status(404).send("404 Not Found: 존재하지 않는 코드입니다.");
    }
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).send("Internal Server Error");
  }
});
function calculateUserType(responses) {
  const scores = {
    emotionExpression: { V: 0, B: 0 },
    crisisResponse: { A: 0, R: 0 },
    socialInteraction: { S: 0, P: 0 },
    ActivityPreference: { O: 0, H: 0 },
  };

  responses.forEach((response) => {
    const { dimension, highScoreTendency, answer } = response;
    const oppositeTendency = {
      V: "B",
      B: "V",
      A: "R",
      R: "A",
      S: "P",
      P: "S",
      O: "H",
      H: "O",
    }[highScoreTendency];

    const highScore = answer;
    const lowScore = 6 - answer;

    scores[dimension][highScoreTendency] += highScore;
    scores[dimension][oppositeTendency] += lowScore;
  });

  // 최종 유형 결정
  const userType = Object.keys(scores)
    .map((dimension) => {
      const tendencies = scores[dimension];
      const sortedTendencies = Object.keys(tendencies).sort(
        (a, b) => tendencies[b] - tendencies[a]
      );

      // 동점 처리
      if (tendencies[sortedTendencies[0]] === tendencies[sortedTendencies[1]]) {
        // 두 특성이 점수가 같다면 랜덤하게 하나를 선택
        return sortedTendencies[Math.floor(Math.random() * 2)];
      }
      return sortedTendencies[0];
    })
    .join("");

  return userType;
}

function generateCode() {
  return Math.random().toString(36).substring(2, 8); // 6자리 랜덤 코드 생성
}

app.post("/submit-responses", async (req, res) => {
  const { responses, code } = req.body;

  if (code) {
    const doc = await db.collection("responses").findOne({ code: code });
    if (doc) {
      const updatedResponses = [...doc.responses, ...responses];
      const userType = calculateUserType(updatedResponses);
      await db
        .collection("responses")
        .updateOne(
          { code: code },
          { $set: { responses: updatedResponses, userType: userType } }
        );
      res.json({
        success: true,
        redirectUrl: `/result2?code=${code}&userType=${userType}`,
      });
    } else {
      res
        .status(404)
        .json({ success: false, message: "코드가 유효하지 않습니다." });
    }
  } else {
    const newCode = generateCode();
    const userType = calculateUserType(responses);
    await db
      .collection("responses")
      .insertOne({ code: newCode, responses: responses, userType: userType });
    res.json({ success: true, redirectUrl: `/result1?code=${newCode}` });
  }
});

// 결과 페이지 1 (코드가 생성된 경우)
app.get("/result1", (req, res) => {
  const code = req.query.code;
  res.render("result1", { code: code });
});

// 결과 페이지 2 (코드로 검사를 완료한 경우)
// app.get("/result2", (req, res) => {
//   const { code, userType } = req.query;
//   res.render("result2", { code: code, userType: userType });
// });

app.get("/result2", async (req, res) => {
  const code = req.query.code; // 결과 페이지로 넘어갈 때 사용된 쿼리 파라미터

  if (!code) {
    return res.status(404).send("코드가 제공되지 않았습니다.");
  }

  try {
    const doc = await db.collection("responses").findOne({ code: code });
    if (!doc) {
      return res.status(404).send("코드에 해당하는 결과를 찾을 수 없습니다.");
    }

    // 데이터베이스에서 가져온 사용자 유형을 결과 페이지에 전달
    res.render("result2", { userType: doc.userType });
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).send("Internal Server Error");
  }
});
