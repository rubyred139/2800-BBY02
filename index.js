require("./utils.js");

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const saltRounds = 12;

const app = express();

const Joi = require("joi");

const port = process.env.PORT || 5000;


const expireTime = 2 * 60 * 60 * 1000; //expires after 2 hr (minutes * seconds * millis)

const mongodb_host = process.env.MONGODB_HOST;
const mongodb_user = process.env.MONGODB_USER;
const mongodb_password = process.env.MONGODB_PASSWORD;
const mongodb_database = process.env.MONGODB_DATABASE;
const mongodb_session_secret = process.env.MONGODB_SESSION_SECRET;

const node_session_secret = process.env.NODE_SESSION_SECRET;

var { database } = include('databaseConnection');

const userCollection = database.db(mongodb_database).collection('users');

app.set('view engine', 'ejs');

app.use(express.urlencoded({ extended: false }));

var mongoStore = MongoStore.create({
  mongoUrl: `mongodb+srv://${mongodb_user}:${mongodb_password}@${mongodb_host}/sessions`,
  crypto: {
    secret: mongodb_session_secret
  }
})

app.use(session({
  secret: node_session_secret,
  store: mongoStore,
  saveUninitialized: false,
  resave: true
}
));

function isValidSession(req) {
  if (req.session.authenticated) {
    return true;
  }
  return false;
}

function sessionValidation(req, res, next) {
  if (isValidSession(req)) {
    next();
  }
  else {
    res.redirect('/');
  }
}

app.get('/', (req, res) => {
  res.render("landing");
});


app.get('/nosql-injection', async (req, res) => {
  var username = req.query.user;

  if (!username) {
    res.send(`<h3>no user provided - try /nosql-injection?user=name</h3> <h3>or /nosql-injection?user[$ne]=name</h3>`);
    return;
  }
  console.log("user: " + username);

  const schema = Joi.string().max(20).required();
  const validationResult = schema.validate(username);

  if (validationResult.error != null) {
    console.log(validationResult.error);
    res.send("<h1 style='color:darkred;'>A NoSQL injection attack was detected!!</h1>");
    return;
  }

  const result = await userCollection.find({ username: username }).project({ username: 1, password: 1, _id: 1 }).toArray();

  console.log(result);

  res.send(`<h1>Hello ${username}</h1>`);
});

app.get('/signup', (req, res) => {
  res.render("signup", { errorMessage: "" });
});

app.post('/signupSubmit', async (req, res) => {
  var username = req.body.username;
  var email = req.body.email;
  var password = req.body.password;

  const schema = Joi.object(
    {
      username: Joi.string().alphanum().max(20).required(),
      email: Joi.string().required(),
      password: Joi.string().required(),

    });

  const validationResult = schema.validate({ username, password, email });

  if (validationResult.error != null) {
    const errorMessage = validationResult.error.message;
    //look at terminal to see error message
    console.log(validationResult.error);

    if (errorMessage.includes('"username"')) {
      const errorMessage = 'Name is required.';
      res.render("signup", { errorMessage: errorMessage });
      return;
    }

    if (errorMessage.includes('"email"')) {
      const errorMessage = 'Email is required.';
      res.render("signup", { errorMessage: errorMessage });
      return;
    }

    if (errorMessage.includes('"password"')) {
      const errorMessage = 'Password is required.';
      res.render("signup", { errorMessage: errorMessage });
      return;
    }

  } else {
    // check if user with the same email already exists
    const existingUser = await userCollection.findOne({ email: email });
    if (existingUser) {
      // email already taken, handle accordingly
      const errorMessage = 'Email already in use.';
      res.render("signup", { errorMessage: errorMessage });
      return;
    };
  };


  var hashedPassword = await bcrypt.hash(password, saltRounds);
//remove the security answer after we connect to the profile page, user will set their own security answer there
  await userCollection.insertOne({ username: username, email: email, password: hashedPassword, securityAnswer: 'dog'});
  console.log("Inserted user");

  //create a session and redirect to main page
  req.session.user = {
    username: username,
    email: email,
  };

  //sets authentication to true 
  req.session.authenticated = true;

  //sets their username
  req.session.username = username;

  res.redirect('/main');

});


app.get('/login', (req, res) => {
  res.render("login", { errorMessage: "" , successMessage: ""});
});

app.post('/loggingin', async (req, res) => {
  var email = req.body.email;
  var password = req.body.password;


  const schema = Joi.string().max(20).required();
  const validationResult = schema.validate(email, password);
  if (validationResult.error != null) {
    console.log(validationResult.error);
    const errorMessage = 'User not found.';
    res.render('login', { errorMessage: errorMessage });
    return;
  }

  const result = await userCollection.find({ email: email }).project({ email: 1, password: 1, username: 1, _id: 1, }).toArray();

  console.log(result);

  if (result.length != 1) {
    console.log("user not found");
    const errorMessage = 'User not found.';
    res.render('login', { errorMessage: errorMessage });
    return;
  }
  if (await bcrypt.compare(password, result[0].password)) {
    console.log("correct password");
    req.session.authenticated = true;
    req.session.username = result[0].username;
    req.session.cookie.maxAge = expireTime;
    req.session.user_type = result[0].user_type;

    res.redirect('/main');
    return;
  }
  else {
    console.log("incorrect password");
    const errorMessage = 'Invalid email/password combination.';
    res.render('login', { errorMessage: errorMessage });
    return;
  }
});

app.get('/changePassword', (req, res) => {
  res.render("changePassword", { errorMessage: ""});
  
});


app.post('/changePassword', async (req, res) => {
  const existingEmail = req.body.email;
  const securityAnswer = req.body.securityAnswer;

  const existingUser = await userCollection.findOne({ email: existingEmail, securityAnswer: securityAnswer });

  if (!existingUser) {
    console.log("invalid combination");
    const errorMessage = "Incorrect answer to the security question.";
    res.render('changePassword', { errorMessage: errorMessage });
    return;
  }

  console.log("both inputs correct");

    // Save email in session
    req.session.email = existingEmail;

  res.redirect('/resetPassword');

});
 
app.get('/resetPassword', (req, res) => {
  const email = req.session.email;
  res.render("resetPassword", {errorMessage: "", email: email});
});

app.post('/resetPassword', async (req, res) => {
  const newPassword = req.body.password;
  const confirmPassword = req.body.confirmPassword;
  const email = req.session.email;  

  if (newPassword !== confirmPassword) {
    const errorMessage = 'Passwords do not match';
    res.render('resetPassword', { errorMessage: errorMessage, email: email });
    return;
  }
  else {
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    await userCollection.updateOne({ email: email }, { $set: { password: hashedPassword } });
    res.render('login', { successMessage: 'Your password has been changed successfully. Please log in again.', errorMessage: ""});
    console.log('password is changed for user with this email: ', email);
  }
});




app.get('/main', sessionValidation, (req, res) => {
  res.render("main");
});


app.get('/quizWelcome', (req, res) => {
  res.render("quizWelcome", { name: req.session.name });
})

app.get('/quiz', (req, res) => {
  if (!req.session.authenticated) {
    res.redirect('/');
  } else {
    var name = req.session.name;
    var userId = req.session._id;
    res.render("quiz", { name, userId })
  }
});

app.post('/quiz', async (req, res) => {
  const db = database.db(mongodb_database);
  const userCollection = db.collection('users');

  const userId = req.session._id;
  const answers = {
    question1: req.body.question1,
    question2: req.body.question2,
    question3: req.body.question3,
    question4: req.body.question4
  };

  try {
    const result = await userCollection.updateOne({ _id: ObjectId(userId) }, { $set: { quizAnswers: answers } });
    console.log('Answers saved to database');
    res.redirect('/members');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error saving quiz answers to database');
  }
});
  

app.get('/logout', (req, res) => {
  req.session.destroy();
  console.log("user logged out");
  res.redirect('/');
});

app.get('/gachaPage', (req, res) => {
    res.render("gachaPage");
})


app.use(express.static(__dirname + "/public"));

app.get("*", (req, res) => {
  res.status(404);
  res.send("Page not found - 404");
})

app.listen(port, () => {
  console.log("Node application listening on port " + port);
}); 