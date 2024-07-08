const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const functions = require("firebase-functions/v1");
const express = require("express"); // import express
const { admin, db } = require("./firebase"); // firebase configuration
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const path = require("path");
const ejs = require("ejs");
const puppeteer = require("puppeteer-core");
const chromium = require("chrome-aws-lambda");
const { Storage } = require("@google-cloud/storage");
const storage = new Storage();
const bucketName = "personal-budget-tracking-table-data";
const bucket = storage.bucket(bucketName);
const { parse } = require("csv-parse");
const fs = require("fs");
const { Readable } = require("stream");
const json2csv = require("json2csv").parse;
const csv = require("csv-parser");
const fastcsv = require("fast-csv");
const { Firestore } = require("firebase-admin/firestore");

const application = express();

const app = express();

app.use(express.json()); //Middleware for JSON bodies

// POST - NEW USER SignUp - /expense/signup
app.post("/expense/signup", async (req, res) => {
  try {
    const { email, password } = req.body; // extract email and password from request body
    if (!email || !password) {
      return res.json({ error: " Invalid email and password" });
    }
    //create new user for firebase authentication
    const userRecord = await admin.auth().createUser({
      email,
      password,
    });
    res.json({ status: "Success", user: userRecord }); // respond success and details
  } catch (error) {
    res.json({ error: error.message }); //error handling if any
  }
});

// POST - USER LOGIN - /expense/login
app.post("/expense/login", async (req, res) => {
  try {
    const { email, password } = req.body; // extract email and password from request body
    const user = await admin.auth().getUserByEmail(email); //// Get user by email from Firebase Authentication
    const token = await admin.auth().createCustomToken(user.uid); //custom token creation
    res.json({ status: "Success", token }); // respond success and token
  } catch (error) {
    res.json({ error: error.message }); //error handling if any
  }
});

// GET - Retrieve all expenses - /expenses
app.get("/expenses", async (req, res) => {
  try {
    const snapshot = await db.collection("expense").get(); // Fetch all expense documents from firestore
    const Expense = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })); //Map documents to array of expense objects
    res.json(Expense); // respond with array of expenses
  } catch (error) {
    res.json({ error: error.message }); //error handling if any
  }
});

// GET - Retrieve a particular - /expense/:id
app.get("/expense/:id", async (req, res) => {
  try {
    // Fetch expense document using id from Firestore
    const ExpenseDoc = await db.collection("expense").doc(req.params.id).get();
    // Check if document with given id exists
    if (!ExpenseDoc.exists) {
      return res.json({ error: "Data not found" });
    }
    res.json({ id: ExpenseDoc.id, ...ExpenseDoc.data() }); // respond with the required expense data
  } catch (error) {
    res.json({ error: error.message }); //error handling if any
  }
});

// POST- Add a new expense - /expense
app.post("/expense", async (req, res) => {
  try {
    const newExpense = req.body; // Extract //category/amount/description

    let ExpenseRef = {};
    ExpenseRef.amount = Number(newExpense.amount);
    ExpenseRef.category = newExpense.category.toUpperCase();
    ExpenseRef.description = newExpense.description;
    ExpenseRef.userid = newExpense.userid;
    ExpenseRef.createdAt = Firestore.FieldValue.serverTimestamp();
    ExpenseRef.version = 1;
    ExpenseRef.updateAt = null;
    const validCategory = [
      "CASH",
      "UPI",
      "CHEQUE",
      "NETBANKING",
      "CREDIT CARD",
    ];

    if (
      !ExpenseRef.category ||
      !ExpenseRef.amount ||
      !ExpenseRef.description ||
      !ExpenseRef.userid
    ) {
      res.status(400).json({ error: "invalid inputs" });
    } else if (!validCategory.includes(ExpenseRef.category)) {
      res.json({ error: "Invalid Category", valid: validCategory });
    } else if (!ExpenseRef.amount) {
      res.status(400).json({ error: "Invalid amount" });
    } else if (!ExpenseRef.description) {
      res.status(400).json({ error: "Invalid description" });
    } else {
      // let expWithId = {};
      const NewExp = await db.collection("expense").add(ExpenseRef);
      ExpenseRef.id = NewExp.id;
      await NewExp.set(ExpenseRef, { merge: true });

      res.json({ status: "Success", id: NewExp.id }); // respond with success and New Expense id
    }
  } catch (error) {
    res.json({ error: error.message }); //error handling if any
  }
});

// DELETE - Delete an expense - /expense/:id
app.delete("/expense/:id", async (req, res) => {
  try {
    const id = req.params.id; //get id from request
    const ExpenseRef = db.collection("expense").doc(id); // reference to the expense document by id
    const ExpenseDoc = await ExpenseRef.get(); // Fetch the document if any with given id
    // Checks if expense data with given id exists
    if (!ExpenseDoc.exists) {
      console.error(`Document with ID ${id} not found`);
      return res.json({ error: "Expense not found" });
    }

    await ExpenseRef.delete(); //Delete document from firestore
    res.json({ status: "success" }); // respond "success" on successfully deleting the data
  } catch (error) {
    res.json({ error: error.message }); //error handling if any
  }
});

// PUT - update an existing expense - /expense/:id
app.put("/expense/:id", async (req, res) => {
  try {
    const id = req.params.id; //expense id from request parameters
    const newExpenseDetails = req.body; //Extracting new data to be updated from request body
    newExpenseDetails.updateAt = Firestore.FieldValue.serverTimestamp();
    newExpenseDetails.version = Firestore.FieldValue.increment(1);
    const ExpenseRef = db.collection("expense").doc(id); // reference to the expense document by id
    const ExpenseDoc = await ExpenseRef.get(); // Fetch the document if any with given id
    // Checks if expense data with given id exists
    if (!ExpenseDoc.exists) {
      console.error(`Document with ID ${id} not found`);
      return res.json({ error: "Expense not found" });
    }
    await ExpenseRef.set(newExpenseDetails, { merge: true }); //update the original document with new detail & keep existing fields
    res.json({ status: "success", expense: { id, ...newExpenseDetails } }); // responds success and new data updated data
  } catch (error) {
    res.json({ error: error.message }); //error handling if any
  }
});

//pdf generation api

// code for pdf generation in local env
// app.post("/generate-pdf-local", async (req, res) => {
//   const ReqCategory = req.body.category.toUpperCase(); //Extracting category and storing it in variable in uppercase form
//   const validCategory = [
//     "CASH",
//     "UPI",
//     "CHEQUE",
//     "NETBANKING",
//     "CREDIT CARD",
//     "ALL",
//   ];
//   //check if category provided is valid or not
//   if (validCategory.includes(ReqCategory)) {
//     try {
//       const snapshot = await db.collection("expense").get(); //get the snapshot of all datasets
//       const data = snapshot.docs.map((doc) => {
//         const docData = doc.data();
//         // console.log(docData.date);
//         const timestamp = docData.date; //storing date in form of firestore timestamp
//         const jsDate = timestamp.toDate(); // storing date in Javascript format
//         //Converting date into IST time format i.e. timezone=Asia/Kolkata
//         const formattedDate = jsDate.toLocaleString(undefined, {
//           timeZone: "Asia/Kolkata",
//         });
//         // console.log(formattedDate);
//         return {
//           id: doc.id,
//           formattedDate: formattedDate,
//           jsDate: jsDate,
//           ...docData,
//         };
//       });
//       data.sort((a, b) => a.jsDate - b.jsDate); ///Sorting according to date
//       //condition for filtering the elements
//       if (ReqCategory === "ALL") {
//         var NewData = data;
//       } else {
//         var NewData = data.filter((doc) => doc.category === ReqCategory);
//       }

//       // Generating HTML content using EJS, sending passing NewData to template.ejs
//       const htmlContent = await ejs.renderFile(
//         path.join(__dirname, "template.ejs"),
//         { NewData }
//       );

//       // // Define the local path
//       // const localPath = path.join(
//       //   "C:",
//       //   "Users",
//       //   "Rahul",
//       //   "Downloads",
//       //   "output.pdf"
//       // );

//       // Create PDF from HTML content
//       // pdf.create(htmlContent).toFile(localPath, (error, result) => {
//       //   if (error) {
//       //     console.error(error);
//       //     return res.status(500).json({ error: error.message });
//       //   }

//       //   // Send success as the response
//       //   res.json({ status: "Success" });
//       // });
//       // pdf.create(htmlContent).toBuffer(async (error, buffer) => {
//       //   if (error) {
//       //     return res.json({ error: error.message });
//       //   }

//       //   const fileName = `table-data-${Date.now()}.pdf`;
//       //   const file = bucket.file(fileName);

//       //   await file.save(buffer);

//       //   const URL = `https://storage.googleapis.com/${bucketName}/${fileName}`;

//       //   res.json({ link: URL });
//       // });

//       const browser = await puppeteer.launch({
//         args: ["--no-sandbox", "--disable-setuid-sandbox"],
//       });

//       const page = await browser.newPage();
//       await page.setContent(htmlContent);
//       const pdfBuffer = await page.pdf({ format: "A4" });
//       await browser.close();

//       const fileName = `table-data-${Date.now()}.pdf`;
//       const file = bucket.file(fileName);

//       await file.save(pdfBuffer);

//       const URL = `https://storage.googleapis.com/${bucketName}/${fileName}`;

//       res.json({ link: URL });
//     } catch (error) {
//       console.error(error);
//       res.status(500).json({ error: error.message, stack: error.stack });
//     }
//   } else {
//     return res.json({ error: "Invalid Category", valid: validCategory });
//   }
// });

// function for pdf generation, storing in cloud bucket and returning its public URL
const generatePDF = async (data) => {
  //// Generating HTML content using EJS, sending passing NewData to template.ejs
  const htmlContent = await ejs.renderFile(
    path.join(__dirname, "template.ejs"),
    {
      NewData: data,
    }
  );

  const fileName = `table-data-${Date.now()}.pdf`; //assigning file name by using date for uniqueness
  const browser = await puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"], // include default chromium arguments and disable Chromium sandbox and setuid sandbox
    defaultViewport: chromium.defaultViewport, // standard viewport settings
    executablePath: await chromium.executablePath,
    headless: chromium.headless, //chromium runs in headless mode (serverless environments)
  });

  const page = await browser.newPage();
  await page.setContent(htmlContent);
  const pdfBuffer = await page.pdf({ format: "A4" }); // page formatting
  await browser.close();

  const file = bucket.file(fileName);
  await file.save(pdfBuffer);

  return `https://storage.googleapis.com/${bucketName}/${fileName}`;
};

application.post("/generate-pdf", async (req, res) => {
  const reqCategory = req.body.category.toUpperCase();
  const validCategory = [
    "CASH",
    "UPI",
    "CHEQUE",
    "NETBANKING",
    "CREDIT CARD",
    "ALL",
  ];
  //Check input data is  valid or not
  if (!validCategory.includes(reqCategory)) {
    return res.json({ error: "Invalid Category", valid: validCategory });
  }

  try {
    const snapshot = await db.collection("expense").get(); // get all data from firestore
    const data = snapshot.docs.map((doc) => {
      const docData = doc.data();
      const jsDate = docData.date.toDate(); //convert the date into proper javascript format of milliseconds
      //convert the javascript date to String format according to the INDIAN STANDARD TIME (IST)
      const formattedDate = jsDate.toLocaleString(undefined, {
        timeZone: "Asia/Kolkata",
      });
      return { id: doc.id, formattedDate, jsDate, ...docData };
    });

    data.sort((a, b) => a.jsDate - b.jsDate); // Sorting the data according to the date
    let filterData;
    //filter data as per request by user
    if (reqCategory === "ALL") {
      filterData = data;
    } else {
      filterData = data.filter((doc) => doc.category === reqCategory);
    }

    const url = await generatePDF(filterData, "template.ejs"); //function call

    res.json({ link: url });
  } catch (error) {
    console.error("Error generating PDF:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

async function readFileFromBucket(bucketName, fileName) {
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(fileName);

  const contents = await file.download();
  const data = contents.toString("utf-8"); // Convert buffer to string
  // const data2 = JSON.parse(data);

  // console.log(contents);
  // console.log(data);

  return data;
}
async function checkcsv(data) {
  // const data = await readFileFromBucket(
  //   "personal-budget-csv",
  //   "importData/Book2.csv"
  // );
  // console.log(data);

  console.log(data);

  const readableStream = new Readable();
  readableStream.push(data);
  readableStream.push(null);

  readableStream
    .pipe(fastcsv.parse({ headers: true }))
    .on("data", async function (row) {
      // console.log(row);
      console.log("category", row.category);
      console.log("description", row.description);
      console.log("amount", row.amount);
      // let e = [];
      // e.first = row.amount;
      // console.log("this is the data ", e);
    });
}

// checkcsv();

async function uploadCSV(bucketName, fileName, data) {
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(fileName);
  // console.log(" csv Data in uploadCSV function ", data);

  await file.save(data);

  return `https://storage.googleapis.com/${bucketName}/${fileName}`;
}
// async function csvToJsonFun() {}
app.post("/expense-csv", async (req, res) => {
  try {
    let e = [];
    let count = 0;
    let success = 0;
    let fail = 0;
    const csvFileName = req.body.fileName;
    const csvBucket = req.body.bucketName;
    // const url = `https://storage.googleapis.com/${csvBucket}/${csvFileName}`
    const csvData = await readFileFromBucket(csvBucket, csvFileName);
    const readableStream = new Readable();
    readableStream.push(csvData);
    readableStream.push(null);
    // let csvToJSON = csv;
    let csvJson = [];
    readableStream
      .pipe(fastcsv.parse({ headers: true }))
      .on("data", (row) => {
        csvJson.push(row);
      })
      .on("end", async () => {
        // console.log("row => ", csvJson);
        for (let data in csvJson) {
          // console.log(csvJson[2].description);
          const validCategory = [
            "CASH",
            "UPI",
            "CHEQUE",
            "NETBANKING",
            "CREDIT CARD",
            "ALL",
          ];

          let newExp = {};
          let eData = {};
          newExp.amount = Number(csvJson[data].amount);
          try {
            newExp.category = csvJson[data].category.toUpperCase();
          } catch (error) {
            continue;
          }

          newExp.description = csvJson[data].description;
          newExp.date = new Date();
          count++;

          if (!newExp.category || !validCategory.includes(newExp.category)) {
            // res.json({
            //   error: `Invalid Category at sr no  ${count} in ${csvFileName}`,
            //   valid: validCategory,
            // });
            fail++;
            eData.recordNumber = count;
            eData.type = "category";
            eData.details = `Invalid Category at recordNumber  ${count} in ${csvFileName}`;
            console.log(eData);
            e.push(eData);
            eData = {};
          } else if (!newExp.amount) {
            // res.status(400).json({
            //   error: `Invalid amount at sr no  ${count} in ${csvFileName}`,
            // });
            fail++;
            eData.recordNumber = count;
            eData.type = "amount";
            eData.details = `Invalid amount at recordNumber  ${count} in ${csvFileName}`;
            // console.log(eData);
            e.push(eData);
            eData = {};
          } else if (!newExp.description) {
            // res.status(400).json({
            //   error: `Invalid description at sr no  ${count} in ${csvFileName}`,
            // });
            fail++;
            eData.recordNumber = count;
            eData.type = "description";
            eData.details = `Invalid description at recordNumber  ${count} in ${csvFileName}`;
            console.log(eData);
            e.push(eData);
            eData = {};
          } else {
            success++;
            const ExpenseNew = await db.collection("expense").add(newExp); //Add new expense to firestore

            // return res.json({
            //   status: "Success",
            //   message: `Data stored form csv file`,
            // }); // respond with success and New Expense id
          }
        }

        if (e.length === 0) {
          console.log("array is 0");
          var errorURL = "success";
        } else {
          console.log("here");
          const errorCSV = json2csv(e);
          // const digit = randomInt(100000);
          // checkcsv(errorCSV);
          var errorURL = await uploadCSV(
            "personal-budget-csv",
            `errorData/Errors-${Date.now()}.csv`,
            errorCSV
          );

          return res.status(200).json({
            TotalRecords: count,
            successRecords: success,
            failRecords: fail,
            details: errorURL,
          });
        }
      });
  } catch (error) {
    res.json({ error: error.message, stack: error.stack }); //error handling if any
  }
});

app.post("/generate-csv", async (req, res) => {
  try {
    // const localPath = path.join(
    //   "C:",
    //   "Users",
    //   "Rahul",
    //   "Downloads",
    //   "output.pdf"
    // );

    const snapshot = await db.collection("expense").get();

    const data = snapshot.docs.map((doc) => {
      const docData = doc.data();
      const jsDate = docData.date.toDate(); //convert the date into proper javascript format of milliseconds
      //convert the javascript date to String format according to the INDIAN STANDARD TIME (IST)
      const formattedDate = jsDate.toLocaleString(undefined, {
        timeZone: "Asia/Kolkata",
      });
      return {
        id: doc.id,
        formattedDate,
        amount: docData.amount,
        category: docData.category,
        description: docData.description,
      };
    });

    const jsonData = json2csv(data);

    const url = await uploadCSV(
      "personal-budget-csv",
      `Csv-data-${Date.now()}.csv`,
      jsonData
    );

    res.json({ link: url, statuts: "success" });
  } catch (error) {
    console.error("Error exporting data:", error);
  }
});

async function createUser(user) {
  let UserRef = db.collection("users").doc();
  user.id = UserRef.id;
  await UserRef.set(user);
  return user.id;
}

app.post("/user", async (req, res) => {
  try {
    let user = {
      name: req.body.name,
      phoneNumber: Number(req.body.phoneNumber),
      createdAt: Firestore.FieldValue.serverTimestamp(),
      version: 1,
      // version:admin.firestore.FieldValue.increment(1) ///for update
      updateAt: Firestore.FieldValue.serverTimestamp(),
    };
    console.log(user);

    if (user.phoneNumber.toString().length !== 10) {
      return res.status(400).json({ message: "Invalid Phone number" });
    }
    let DataRef = db.collection("users");

    let querySnapshot = await DataRef.where(
      "phoneNumber",
      "==",
      user.phoneNumber
    ).get();

    console.log("docd Size ", querySnapshot.size);
    if (querySnapshot.empty) {
      const uid = await createUser(user);
      res.json({ status: "Success", id: uid });
    } else {
      return res.json({ error: "phoneNumber exists. Provide unique no" });
    }
  } catch (error) {
    res.json({ error: error.message, stack: error.stack });
  }
});

app.put("/update-user/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const newdata = req.body;
    newdata.updateAt = Firestore.FieldValue.serverTimestamp();
    newdata.version = Firestore.FieldValue.increment(1);
    const UserRef = db.collection("users").doc(id); // reference to the expense document by id
    const UserDoc = await UserRef.get();

    if (!UserDoc.exists) {
      res.status(400).json({ message: "doc exist" });
    }
    await UserRef.update({ ...newdata });
    res.json({ status: "success" });
  } catch (error) {
    res.json({ error: error.message, stack: error.stack });
  }
});

async function createExpense(status, msg, newExp) {
  const validCategory = [
    "CASH",
    "UPI",
    "CHEQUE",
    "NETBANKING",
    "CREDIT CARD",
    "ALL",
  ];

  if (!newExp.category || !validCategory.includes(newExp.category)) {
    msg.fail++;
    status.errorDetail = "Invalid Category";
  } else if (!newExp.amount) {
    msg.fail++;
    status.errorDetail = "Invalid amount";
  } else if (!newExp.description) {
    msg.fail++;
    status.errorDetail = "Invalid description";
  } else {
    msg.success++;
    status.errorDetail = "No error";
    const ExpenseNew = await db.collection("expense").add(newExp);
    newExp.id = ExpenseNew.id;
    await ExpenseNew.set(newExp);
  }
  return status, msg;
}

function CheckExpense(newExp, status) {
  const validCategory = [
    "CASH",
    "UPI",
    "CHEQUE",
    "NETBANKING",
    "CREDIT CARD",
    "ALL",
  ];

  if (!newExp.category || !validCategory.includes(newExp.category)) {
    status.errorDetail = "Invalid Category";
  } else if (!newExp.amount) {
    status.errorDetail = "Invalid amount";
  } else if (!newExp.description) {
    status.errorDetail = "Invalid description";
  } else {
    status.errorDetail = "No error";
  }
  return status;
}
app.post("/expense-user-csv", async (req, res) => {
  try {
    // let fail = 0;
    // let success = 0;
    let msg = {
      success: 0,
      fail: 0,
    };
    const csvFileName = req.body.fileName;
    const csvBucket = req.body.bucketName;
    const csvData = await readFileFromBucket(csvBucket, csvFileName);
    const readableStream = new Readable();
    readableStream.push(csvData);
    readableStream.push(null);
    // let csvToJSON = csv;
    let ReportJSON = [];
    let csvJson = [];
    readableStream
      .pipe(fastcsv.parse({ headers: true }))
      .on("data", (row) => {
        csvJson.push(row);
      })
      .on("end", async () => {
        // console.log("row => ", csvJson);
        for (let data in csvJson) {
          // console.log(csvJson);
          // console.log(csvJson[2].amount);
          // console.log(typeof csvJson[data].phoneNumber);

          // console.log(newUser);
          let status = {
            phoneNumber: csvJson[data].phoneNumber,
            name: csvJson[data].name,
            amount: csvJson[data].amount,
            category: csvJson[data].category,
            description: csvJson[data].description,
            errorDetail: null,
          };

          let newExp = {};
          newExp.amount = Number(csvJson[data].amount);
          try {
            newExp.category = csvJson[data].category.toUpperCase();
          } catch (error) {
            continue;
          }
          newExp.description = csvJson[data].description;
          newExp.userid = null;
          newExp.createdAt = Firestore.FieldValue.serverTimestamp();
          newExp.updateAt = null;
          newExp.version = Firestore.FieldValue.increment(1);
          CheckExpense(newExp, status);
          if (status.errorDetail === "No error") {
          }

          let DataRefUser = db.collection("users");

          let querySnapshot = await DataRefUser.where(
            "phoneNumber",
            "==",
            Number(csvJson[data].phoneNumber)
          ).get();
          // console.log(query);
          if (querySnapshot.empty) {
            let newUser = {
              name: csvJson[data].name,
              phoneNumber: Number(csvJson[data].phoneNumber),
              createdAt: Firestore.FieldValue.serverTimestamp(),
              updateAt: null,
              version: Firestore.FieldValue.increment(1),
              id: null,
            };

            if (newUser.phoneNumber.toString().length !== 10) {
              msg.fail++;
              status.status = "Invalid phoneNumber";
            } else {
              const uid = await createUser(newUser);
              console.log("uid is =>", uid);
              newExp.userid = uid;
              let tempFail = msg.fail;
              await createExpense(status, msg, newExp);
              if (tempFail === msg.fail) {
                status.status = " user and expense added";
              } else {
                status.status = "User created, Data not added";
              }
              ReportJSON.push(status);
            }
          } else {
            querySnapshot.forEach((doc) => {
              newExp.userid = doc.id;
            });
            let tempFail = msg.fail;
            await createExpense(status, msg, newExp);
            if (tempFail === msg.fail) {
              status.status = " expense added";
            } else {
              status.status = "No data added";
            }
            ReportJSON.push(status);
          }
        }
        const ReportCSV = json2csv(ReportJSON);
        // const digit = randomInt(100000);
        // checkcsv(errorCSV);
        var ReportURL = await uploadCSV(
          "personal-budget-csv",
          `Reports/file-${Date.now()}.csv`,
          ReportCSV
        );
        // let fail = csvJson.length - success;

        return res.status(200).json({
          TotalRecords: csvJson.length,
          successRecords: msg.success,
          failRecords: msg.fail,
          link: ReportURL,
        });
      });
  } catch (error) {
    res.json({ error: error.message, stack: error.stack }); //error handling if any
  }
});

application.post("/user-pdf", async (req, res) => {
  try {
    const userid = req.body.userid;
    let pdfData = [];
    let userData = [];

    let DataRefUser = db.collection("users");
    let userSnapshot = await DataRefUser.where("id", "==", userid).get();
    if (userSnapshot.empty) {
      return res.status(400).json({ error: "doc not found" });
    } else {
      userSnapshot.forEach((doc) => {
        const docData = doc.data();
        const name = docData.name;
        // console.log(name);
        userData.push({ Name: name });
        let newdate = new Date();
        const newformattedDate = newdate.toLocaleString(undefined, {
          timeZone: "Asia/Kolkata",
        });

        userData.push({ DateAndTime: newformattedDate });
      });
    }

    let DataRefExp = db.collection("expense");

    let querySnapshot = await DataRefExp.where("userid", "==", userid).get();
    if (querySnapshot.empty) {
      return res.status(400).json({ error: "doc not found" });
    } else {
      querySnapshot.forEach((doc) => {
        const docData = doc.data();
        const jsDate = docData.createdAt.toDate();

        const formattedDate = jsDate.toLocaleString(undefined, {
          timeZone: "Asia/Kolkata",
        });
        docData.formattedDate = formattedDate;
        docData.jsDate = jsDate;

        pdfData.push(docData);
      });
      pdfData.sort((a, b) => a.jsDate - b.jsDate);

      const htmlContent = await ejs.renderFile(
        path.join(__dirname, "UserTemplate.ejs"),
        {
          NewData: pdfData,
          userData: userData,
        }
      );

      const fileName = `table-data-${Date.now()}.pdf`; //assigning file name by using date for uniqueness
      const browser = await puppeteer.launch({
        args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"], // include default chromium arguments and disable Chromium sandbox and setuid sandbox
        defaultViewport: chromium.defaultViewport, // standard viewport settings
        executablePath: await chromium.executablePath,
        headless: chromium.headless, //chromium runs in headless mode (serverless environments)
      });

      const page = await browser.newPage();
      await page.setContent(htmlContent);
      const pdfBuffer = await page.pdf({ format: "A4" }); // page formatting
      await browser.close();

      const file = bucket.file(fileName);
      await file.save(pdfBuffer);

      const url = `https://storage.googleapis.com/${bucketName}/${fileName}`;
      res.status(400).json({ link: url });
    }
  } catch (error) {
    return res.status(500).json({ error: error, stack: error.stack });
  }
});

exports.api = onRequest(app);

exports.applicationGen2 = onRequest({ memory: "512MiB" }, application);
// exports.applicationGen1 = functions
//   .runWith({ memory: "512MB", timeoutSeconds: 120 })
//   .https.onRequest(application);

// Export function for API with memory allocation of 2Gib and timeout of 120 seconds

//Triggers

//Trigger for creation of new doc
exports.onExpenseCreate = onDocumentCreated("expense/{expenseId}", (event) => {
  // const newData = event.data;
  const newValue = event.data.data();
  const eId = event.params.expenseId;
  logger.log("New Expense created in DB");

  console.log("New expense created:", newValue);
  console.log("id", eId);

  return null;
});

//trigger for data updatation
exports.onExpenseUpdated = onDocumentUpdated("expense/{expenseId}", (event) => {
  const beforeValue = event.data.before.data(); //get data before updation
  const afterValue = event.data.after.data(); // get Data after updation

  // function to get only updated data
  const getUpdatedValue = (beforeValue, afterValue) => {
    const updatedValue = {};
    for (const key in afterValue) {
      if (afterValue[key] !== beforeValue[key]) {
        updatedValue[key] = afterValue[key];
      }
    }
    return updatedValue;
  };

  const updatedData = getUpdatedValue(beforeValue, afterValue); //function call
  logger.log("Data Updated");
  console.log("Data updated as : ", updatedData);
  return null;
});

//trigger for data deletion
exports.onExpenseDeleted = onDocumentDeleted("expense/{expenseId}", (event) => {
  const deletedData = event.data.data();
  logger.log("Data Deleted");
  console.log("Data Deleted :", deletedData);
  return null;
});
