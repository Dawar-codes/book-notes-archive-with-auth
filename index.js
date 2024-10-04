import express from "express";
import axios from "axios";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import session from "express-session";
import dotenv from "dotenv";


const app = express();
const port = process.env.PORT || 3000;
const saltRounds = 10;
dotenv.config();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(passport.initialize());
app.use(passport.session());


const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Ensure SSL is configured
  },
  // user: process.env.DB_USER,
  // host: process.env.DB_HOST,
  // database: process.env.DB_NAME, // Use the name of your database here
  // password: process.env.DB_PASSWORD,
  // port: process.env.DB_PORT || 5432, // Use 5432 as a default if not set
});

db.connect()
  .then(() => {
    console.log("Connected to the database");
  })
  .catch((err) => {
    console.error("Database connection error:", err);
  });


let books = [];

async function getBook(currUser) {
  
  try {
    
    const result = await db.query("SELECT * FROM book JOIN users ON users.id=book.user_id WHERE email=$1 ORDER BY book.id DESC",
      [currUser]);
    books = result.rows;
    console.log(books);
    return books;

  } catch (error) {

    console.error("Error fetching books:", error);
    return [];
  }
};


async function getBooksByTitle(title) {
  try {
    const result = await db.query("SELECT * FROM book WHERE title ILIKE '%' || $1 || '%';", [title]);
    return result.rows; // Return the filtered books
  } catch (error) {
    console.error("Error fetching books:", error);
    return []; // Return an empty array in case of an error
  }
}

app.get("/", (req, res) => {
  res.render("home.ejs");
})

// app.get("/main", async (req, res) => {
//   const books = await getBook();
//   res.render("index.ejs", { books: books });
// });


app.get("/login", (req, res) =>{
  res.render("login.ejs")
});


app.get("/register", (req, res) => {
  res.render("register.ejs")
});

app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

app.get("/main", async (req, res) => {
  
  if (req.isAuthenticated()) {
    const currentUser = req.user.email;
    const userName = req.user.name;
    
    try {
      const result = await db.query("SELECT * FROM users JOIN book ON users.id=book.user_id WHERE email = $1",[currentUser]);
      const userBooks = result.rows;
      if (userBooks) {
        res.render("index.ejs", {books: userBooks, name: userName});
      } else {
        res.render("index.ejs", {books: "Add your books"});
      }
    } catch (error) {
      console.log(error)
    }

    //TODO: Update this to pull in the user secret to render in secrets.ejs
  } else {
    res.redirect("/login");
  }
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/main",
  passport.authenticate("google", {
    successRedirect: "/main",
    failureRedirect: "/login",
  })
);

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/main",
    failureRedirect: "/login",
  })
);

app.post("/register", async (req, res) => {
  const email = req.body.username;
  const password = req.body.password;
  const name = req.body.fullname;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (checkResult.rows.length > 0) {
      res.redirect("/login");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
        } else {
          const result = await db.query(
            "INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING *",
            [email, hash, name]
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            console.log("success");
            res.redirect("/main");
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

app.post("/searchList", async (req, res) => {
  const email = req.user.email;
  const searchTerm = req.body.getBookName;
  const getbooks = await getBook(email);
  try {
    const response = await axios.get(`https://openlibrary.org/search.json?q=${searchTerm}&limit=10`);
    const books = response.data.docs;
    res.render("index.ejs", { searchedBook: books, books: getbooks, searchTerm: searchTerm });
  } catch (error) {
    console.error(error);
    res.render("index.ejs", { books: [], searchTerm: searchTerm });
  }
});



app.get("/searchInside", async (req, res) => {
  const title = req.query.title;
  try {
      const books = await getBooksByTitle(title);
  res.render("index.ejs", { books });
  } catch (error) {
    console.log(error)
  }
  
});



app.get("/addBook", (req, res) => {

  const title = req.query.title;
  const cover = req.query.cover
  const author = req.query.author;

  res.render("addBook.ejs", { title: title, cover: cover, author: author});
});

app.post("/addBook", async (req, res) => {
  
  const email = req.user.email;
  const { title, author, rating, cover, date, review } = req.body;
  try {
    const result1= await db.query("SELECT id FROM users WHERE email=$1",[email] );
    const theUser = result1.rows[0].id;
    console.log(typeof theUser);
    const result = await db.query("INSERT INTO book (title, author, rating, cover_id, date_added, review, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", 
      [title, author, rating, cover, date, review, theUser]);

  } catch (error) {
    console.log(error);
  }


  res.redirect("/main");

});


app.get("/notes/:id", async (req, res) => {

  console.log("Params received:", req.params);
  const id = parseInt(req.params.id);
  console.log("ID received:", id);

  try {
    const result = await db.query(`
    SELECT book.*, notes.book_notes 
    FROM book 
    LEFT JOIN notes ON book.id = notes.id 
    WHERE book.id = $1`,
      [id]
    );
    if (result.rows.length > 0) {
      const book = result.rows[0]; // Fetch the first (and only) book
      res.render("notes.ejs", { book: book });
    } else {
      res.status(404).send("Book not found");
    }
  } catch (error) {
    console.log(error);
  }
});


app.post("/edit", async (req, res) => {
  const notes = req.body.updatedNotes;
  const id = req.body.id;

  console.log("Updated Notes:", notes);
  console.log("ID:", id);

  try {
    const noteCheck = await db.query("SELECT * FROM notes WHERE id = $1", [id]);

    if (noteCheck.rows.length === 0) {
      // If no note exists, insert a new note
      await db.query("INSERT INTO notes (id, book_notes) VALUES ($1, $2)", [id, notes]);
    } else {
      // If a note exists, update it
      await db.query("UPDATE notes SET book_notes = $1 WHERE id = $2", [notes, id]);
    }


    const result = await db.query("SELECT * FROM book JOIN notes USING (id) WHERE id =$1", [id]);
    if (result.rows.length > 0) {
      const book = result.rows[0];

      res.render("notes.ejs", { book: book });
    } else {
      res.status(404).send("Book not found");
    }

  } catch (error) {
    console.log(err);
  }

});

app.post("/delete/book/:id", async (req, res) => {
  const id = req.params.id;

  try {
    await db.query("DELETE FROM book WHERE id=$1", [id]);
    res.redirect("/main");
  } catch (error) {
    console.log(error);
  }
});


/* ---------------------------------------Strategies and serialize,deserialize--------------------------------------- */


passport.use(
  "local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1 ", [
        username,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              return cb(null, user);
            } else {
              return cb(null, false);
            }
          }
        });
      } else {
        return cb("User not found");
      }
    } catch (err) {
      console.log(err);
    }
  })
);

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/main",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        console.log(profile);
        const result = await db.query("SELECT * FROM users WHERE email = $1", [
          profile.email,
        ]);
        if (result.rows.length === 0) {
          const newUser = await db.query(
            "INSERT INTO users (email, password, name, auth_provider) VALUES ($1, $2, $3, $4) Returning *",
            [profile.email, await bcrypt.hash("oauth_user_dummy_password", saltRounds), profile.displayName, "google"]
          );
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    }
  )
);
passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});





app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

