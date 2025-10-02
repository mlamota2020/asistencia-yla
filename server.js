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

  const app = express();

  app.set('port', process.env.PORT || 3000);
  app.set('views', path.join(__dirname, 'views'));

  app.engine('.hbs', exphbs.engine({
    defaultLayout: 'main',
    layoutsDir: path.join(app.get('views'), 'layouts'),
    partialsDir: path.join(app.get('views'), 'partials'),
    extname: '.hbs'
  }));
  app.set('view engine', '.hbs');

  app.use(express.urlencoded({ extended: false }));
  app.use(morgan('dev'));

  // Flash messages
  app.use(session({ secret: 'attendance-secret', resave: false, saveUninitialized: false }));
  app.use(flash());
  app.use((req, res, next) => {
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
  });

  // GET - Show students
  app.get('/', async (req, res) => {
    const estudiantes = await collection.find().toArray();
    res.render('index', { estudiantes });
  });

  // POST - Mark attendance
  app.post('/asistir', async (req, res) => {
    const { studentId } = req.body;
    const cedEstudiante = `${studentId}`;
    const now = new Date();
    const cutoff = new Date();
    cutoff.setHours(7, 30, 0, 0);

    const status = now <= cutoff ? "Presente" : "Atrasado";

    try {
      const student = await collection.findOne({ cedula: cedEstudiante });
      if (!student) {
        req.flash('error', "❌ Estudiante no encontrado.");
        return res.redirect('/');
      }

      if (student.status && student.status !== "No ha asistido") {
        req.flash('error', `ℹ️ ${student.nombre} ya tiene estado de asistencia.`);
      } else {
        await collection.updateOne(
          { cedula: cedEstudiante },
          { $set: { status } }
        );
        req.flash('success', `✅ ${student.nombre} marcado/a como ${status.toUpperCase()}.`);
      }

      res.redirect('/');
    } catch (err) {
      console.error(err);
      req.flash('error', "⚠️ Error al actualizar asistencia.");
      res.redirect('/');
    }
  });

  // CRON - Reset all students at midnight
  cron.schedule("0 0 * * *", async () => {
    console.log("Reseteando la asistencia...");
    await collection.updateMany({}, { $set: { status: "No ha asistido" } });
    console.log("Asistencia reseteada!");
  });

  app.listen(app.get('port'), () => {
    console.log("🚀 Server running on port", app.get('port'));
  });

}

main().catch(err => console.error(err));