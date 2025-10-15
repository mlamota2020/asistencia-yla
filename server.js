const express = require('express');
const path = require('path');
const exphbs = require('express-handlebars');
const morgan = require('morgan');
const { MongoClient, ObjectId } = require('mongodb');
const session = require('express-session');
const flash = require('connect-flash');
const cron = require('node-cron');

const uri = 'mongodb+srv://asistencias_yla:asistencias_yla@estudiantes-db.qt0rem0.mongodb.net/?retryWrites=true&w=majority&appName=estudiantes-db';
const client = new MongoClient(uri);

const dbName = "estudiantes-db";
const collectionName = "estudiantes";

async function main() {
  await client.connect();
  console.log("DB connected");

  const db = client.db(dbName);
  const collection = db.collection(collectionName);

  // 🧹 One-time migration (fix attendance fields)
  await fixAttendanceFields(collection);

  const app = express();

  app.set('port', process.env.PORT || 3000);
  app.set('views', path.join(__dirname, 'views'));

  // Handlebars setup with eq helper for color highlighting
  app.engine('.hbs', exphbs.engine({
    defaultLayout: 'main',
    layoutsDir: path.join(app.get('views'), 'layouts'),
    partialsDir: path.join(app.get('views'), 'partials'),
    extname: '.hbs',
    helpers: {
      eq: (a, b) => a === b
    }
  }));
  app.set('view engine', '.hbs');

  app.use(express.urlencoded({ extended: false }));
  app.use(morgan('dev'));

  app.use(session({ secret: 'attendance-secret', resave: false, saveUninitialized: false }));
  app.use(flash());
  app.use((req, res, next) => {
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
  });

  // 🧾 GET - Show students and weekly attendance
app.get('/', async (req, res) => {
  try {
    const estudiantes = await collection.find().toArray();

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const weekDates = getWeekDates(today);

    // debug: log to console so you can see what's being passed to Handlebars
    console.log('todayStr =', todayStr);
    console.log('weekDates =', weekDates);

    estudiantes.forEach(est => {
      const attendanceArray = Array.isArray(est.attendance) ? est.attendance : [];
      est.displayAttendance = weekDates.map(date => {
        const record = attendanceArray.find(a => a.date === date);
        return record ? record.status : "No ha Asistido";
      });
    });

    res.render('index', { estudiantes, weekDates, today: todayStr });
  } catch (err) {
    console.error('GET / error:', err);
    res.status(500).send('Error loading students');
  }
});

app.get('/lista', async (req, res) => {
  try {
    const estudiantes = await collection.find().toArray();

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const weekDates = getWeekDates(today);

    // debug: log to console so you can see what's being passed to Handlebars
    console.log('todayStr =', todayStr);
    console.log('weekDates =', weekDates);

    estudiantes.forEach(est => {
      const attendanceArray = Array.isArray(est.attendance) ? est.attendance : [];
      est.displayAttendance = weekDates.map(date => {
        const record = attendanceArray.find(a => a.date === date);
        return record ? record.status : "No ha Asistido";
      });
    });

    res.render('lista', { estudiantes, weekDates, today: todayStr });
  } catch (err) {
    console.error('GET / error:', err);
    res.status(500).send('Error loading students');
  }
});

  // 📅 POST - Mark attendance
  app.post('/asistir', async (req, res) => {
    const { studentId } = req.body;
    const now = new Date();
    const cutoff = new Date();
    cutoff.setHours(7, 30, 0, 0);

    console.log("studentId from form:", req.body.studentId);

    const today = now.toISOString().split('T')[0];
    const status = now <= cutoff ? "Presente" : "Atrasado";

    try {
      const student = await collection.findOne({ cedula: studentId });
      if (!student) {
        req.flash('error', "Estudiante no encontrado");
        return res.redirect('/');
      }

      // Ensure attendance is an array
      if (!Array.isArray(student.attendance)) {
        await collection.updateOne(
          { _id: student._id },
          { $set: { attendance: [] } }
        );
        student.attendance = [];
      }

      const existing = student.attendance.find(a => a.date === today);
      if (existing) {
        req.flash('error', `${student.nombre} ya tiene estado hoy: ${existing.status.toUpperCase()}`);
      } else {
        await collection.updateOne(
          { _id: student._id },
          { $push: { attendance: { date: today, status } } }
        );
        req.flash('success', `${student.nombre} marcado como ${status.toUpperCase()}`);
      }

      res.redirect('/');
    } catch (err) {
      console.error(err);
      req.flash('error', "Error al actualizar asistencia");
      res.redirect('/');
    }
  });

  // 🔁 CRON - Reset attendance every Monday at midnight
  cron.schedule("0 0 * * 1", async () => {
    console.log("Starting new week, clearing attendance...");
    await collection.updateMany({}, { $set: { attendance: [] } });
    console.log("Attendance reset for the new week");
  });

  app.listen(app.get('port'), () => {
    console.log("Server running on port", app.get('port'));
  });
}

// 📦 Helper: One-time migration for old data
async function fixAttendanceFields(collection) {
  const candidates = await collection.find({ attendance: { $exists: true } }).toArray();
  for (const doc of candidates) {
    if (!Array.isArray(doc.attendance)) {
      console.log(`Fixing attendance for ${doc._id}`);
      await collection.updateOne(
        { _id: doc._id },
        { $set: { attendance: [] } }
      );
    }
  }
}

// 🗓️ Utility: Get current week's Mon–Sun dates
function getWeekDates(date) {
  // ensure `date` is a Date object
  const d = (date instanceof Date) ? new Date(date) : new Date();

  // find Monday of the week containing `d`
  const day = d.getDay();           // 0 (Sun) .. 6 (Sat)
  const diffToMonday = d.getDate() - day + (day === 0 ? -3 : 1); // if sunday go back 6 days
  const monday = new Date(d);
  monday.setDate(diffToMonday);
  monday.setHours(0,0,0,0); // normalize to start of day

  const days = [];
  for (let i = 0; i < 4; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    // format YYYY-MM-DD
    days.push(dd.toISOString().split('T')[0]);
  }
  return days;
}


main().catch(err => console.error(err));
