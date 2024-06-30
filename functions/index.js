const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const express = require("express"); // import express
const { admin, db } = require("./firebase"); // firebase configuration
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const path = require("path");
const ejs = require("ejs");
const puppeteer = require("puppeteer");
const chromium = require("chrome-aws-lambda");
const { Storage } = require("@google-cloud/storage");
const storage = new Storage();
const bucketName = "personal-budget-tracking-table-data";
const bucket = storage.bucket(bucketName);

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

    newExpense.date = new Date(); //add date to new data
    let ExpenseRef = {};
    ExpenseRef.amount = Number(newExpense.amount);
    ExpenseRef.category = newExpense.category.toUpperCase();
    ExpenseRef.description = newExpense.description;
    ExpenseRef.date = newExpense.date;

    const validCategory = [
      "CASH",
      "UPI",
      "CHEQUE",
      "NETBANKING",
      "CREDIT CARD",
    ];

    if (!ExpenseRef.category || !ExpenseRef.amount || !ExpenseRef.description) {
      res.status(400).json({ error: "invalid inputs" });
    } else if (!validCategory.includes(ExpenseRef.category)) {
      res.json({ error: "Invalid Category", valid: validCategory });
    } else if (!ExpenseRef.amount) {
      res.status(400).json({ error: "Invalid amount" });
    } else if (!ExpenseRef.description) {
      res.status(400).json({ error: "Invalid description" });
    } else {
      const ExpenseNew = await db.collection("expense").add(ExpenseRef); //Add new expense to firestore
      res.json({ status: "Success", id: ExpenseNew.id }); // respond with success and New Expense id
    }

    // if (ExpenseRef.category && ExpenseRef.amount && ExpenseRef.description) {
    //   const ExpenseNew = await db.collection("expense").add(ExpenseRef); //Add new expense to firestore
    //   res.json({ status: "Success", id: ExpenseNew.id }); // respond with success and New Expense id
    // } else if (!ExpenseRef.category) {
    //   res.status(400).json({ error: "Invalid category" });
    // } else if (!ExpenseRef.amount) {
    //   res.status(400).json({ error: "Invalid amount" });
    // } else if (!ExpenseRef.description) {
    //   res.status(400).json({ error: "Invalid description" });
    // } else {
    //   res.json({ error: " Inavlid Inputs" });
    // }
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
    newExpenseDetails.date = new Date(); // Add current date to the new Expense data
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
app.post("/generate-pdf-local", async (req, res) => {
  const ReqCategory = req.body.category.toUpperCase(); //Extracting category and storing it in variable in uppercase form
  const validCategory = [
    "CASH",
    "UPI",
    "CHEQUE",
    "NETBANKING",
    "CREDIT CARD",
    "ALL",
  ];
  //check if category provided is valid or not
  if (validCategory.includes(ReqCategory)) {
    try {
      const snapshot = await db.collection("expense").get(); //get the snapshot of all datasets
      const data = snapshot.docs.map((doc) => {
        const docData = doc.data();
        // console.log(docData.date);
        const timestamp = docData.date; //storing date in form of firestore timestamp
        const jsDate = timestamp.toDate(); // storing date in Javascript format
        //Converting date into IST time format i.e. timezone=Asia/Kolkata
        const formattedDate = jsDate.toLocaleString(undefined, {
          timeZone: "Asia/Kolkata",
        });
        // console.log(formattedDate);
        return {
          id: doc.id,
          formattedDate: formattedDate,
          jsDate: jsDate,
          ...docData,
        };
      });
      data.sort((a, b) => a.jsDate - b.jsDate); ///Sorting according to date
      //condition for filtering the elements
      if (ReqCategory === "ALL") {
        var NewData = data;
      } else {
        var NewData = data.filter((doc) => doc.category === ReqCategory);
      }

      // Generating HTML content using EJS, sending passing NewData to template.ejs
      const htmlContent = await ejs.renderFile(
        path.join(__dirname, "template.ejs"),
        { NewData }
      );

      // // Define the local path
      // const localPath = path.join(
      //   "C:",
      //   "Users",
      //   "Rahul",
      //   "Downloads",
      //   "output.pdf"
      // );

      // Create PDF from HTML content
      // pdf.create(htmlContent).toFile(localPath, (error, result) => {
      //   if (error) {
      //     console.error(error);
      //     return res.status(500).json({ error: error.message });
      //   }

      //   // Send success as the response
      //   res.json({ status: "Success" });
      // });
      // pdf.create(htmlContent).toBuffer(async (error, buffer) => {
      //   if (error) {
      //     return res.json({ error: error.message });
      //   }

      //   const fileName = `table-data-${Date.now()}.pdf`;
      //   const file = bucket.file(fileName);

      //   await file.save(buffer);

      //   const URL = `https://storage.googleapis.com/${bucketName}/${fileName}`;

      //   res.json({ link: URL });
      // });

      const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const page = await browser.newPage();
      await page.setContent(htmlContent);
      const pdfBuffer = await page.pdf({ format: "A4" });
      await browser.close();

      const fileName = `table-data-${Date.now()}.pdf`;
      const file = bucket.file(fileName);

      await file.save(pdfBuffer);

      const URL = `https://storage.googleapis.com/${bucketName}/${fileName}`;

      res.json({ link: URL });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  } else {
    return res.json({ error: "Invalid Category", valid: validCategory });
  }
});

// code for pdf generation on deployment
const getBrowserInstance = async () => {
  return await chromium.puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
  });
};

app.post("/generate-pdf-3", async (req, res) => {
  const ReqCategory = req.body.category.toUpperCase();
  const validCategory = [
    "CASH",
    "UPI",
    "CHEQUE",
    "NETBANKING",
    "CREDIT CARD",
    "ALL",
  ];

  if (!validCategory.includes(ReqCategory)) {
    return res.json({ error: "Invalid Category", valid: validCategory });
  }

  try {
    const snapshot = await db.collection("expense").get();
    const data = snapshot.docs.map((doc) => {
      const docData = doc.data();
      const jsDate = docData.date.toDate();
      const formattedDate = jsDate.toLocaleString(undefined, {
        timeZone: "Asia/Kolkata",
      });
      return { id: doc.id, formattedDate, jsDate, ...docData };
    });

    data.sort((a, b) => a.jsDate - b.jsDate);
    let NewData;
    if (ReqCategory === "ALL") {
      NewData = data;
    } else {
      NewData = data.filter((doc) => doc.category === ReqCategory);
    }

    const htmlContent = await ejs.renderFile(
      path.join(__dirname, "template.ejs"),
      { NewData }
    );
    const browser = await getBrowserInstance();
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "load" });

    const pdfBuffer = await page.pdf({ format: "A4" });
    await browser.close();

    const fileName = `table-data-${Date.now()}.pdf`;
    const file = bucket.file(fileName);
    await file.save(pdfBuffer);

    const URL = `https://storage.googleapis.com/${bucketName}/${fileName}`;
    res.json({ link: URL });
  } catch (error) {
    console.error("Error generating PDF:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

exports.api = onRequest({ memory: "2GiB", timeout: 120 }, app); // Export function

//Triggers

//Trigger for creation of new doc
exports.onExpenseCreate = onDocumentCreated("expense/{expenseId}", (event) => {
  const newValue = event.data.data();
  logger.log("New Expense created in DB");
  console.log("New expense created:", newValue);
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
