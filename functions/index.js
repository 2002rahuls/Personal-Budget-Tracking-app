const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

const functions = require("firebase-functions"); // import firebase-functions
const express = require("express"); // impor express
const { admin, db } = require("./firebase"); // firebase configuration

const app = express(); //express app started

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
    ExpenseRef.category = newExpense.category;
    ExpenseRef.description = newExpense.description;
    ExpenseRef.date = newExpense.date;

    if (ExpenseRef.category && ExpenseRef.amount && ExpenseRef.description) {
      const ExpenseNew = await db.collection("expense").add(ExpenseRef); //Add new expense to firestore
      res.json({ status: "Success", id: ExpenseNew.id }); // respond with success and New Expense id
    } else if (!ExpenseRef.category) {
      res.status(400).json({ error: "Invalid category" });
    } else if (!ExpenseRef.amount) {
      res.status(400).json({ error: "Invalid amount" });
    } else if (!ExpenseRef.description) {
      res.status(400).json({ error: "Invalid description" });
    } else {
      res.json({ error: " Inavlid Inputs" });
    }
  } catch (error) {
    res.json({ error: error.message }); //error handling if any
  }
});

// DELETE - Delete an expense - /expense/:id
app.delete("/expense/:id", async (req, res) => {
  try {
    const ExpenseRef = db.collection("expense").doc(req.params.id); // creating a reference to the data using id
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

exports.api = functions.https.onRequest(app); // Export function
