// server/index.js

const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");

// Express anlegen und Middleware einbinden
const app = express();
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use(cors({ origin: "http://127.0.0.1:8080" }));

// SQLite-Datenbank öffnen / erstellen
// (Datei 'database.db' wird automatisch angelegt, wenn sie nicht existiert)
const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath);

// Tabellen anlegen (falls sie nicht existieren)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS drivers (
      driver_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS vehicles (
      vehicle_id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_plate TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS trips (
      trip_id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL,
      vehicle_id INTEGER NOT NULL,
      start_time TEXT,
      end_time TEXT,
      start_lat REAL,
      start_lon REAL,
      end_lat REAL,
      end_lon REAL,
      distance REAL,
      FOREIGN KEY (driver_id) REFERENCES drivers(driver_id),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS trip_points (
      point_id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      lat REAL,
      lon REAL,
      timestamp TEXT,
      FOREIGN KEY (trip_id) REFERENCES trips(trip_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS gpx_files (
      gpx_file_id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL UNIQUE,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

app.get('/api/files', (req, res) => {
    const sql = 'SELECT * FROM gpx_files ORDER BY uploaded_at DESC';
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to fetch files' });
        }
        res.json({ files: rows });
    });
});

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() }); // Store files in memory for processing

app.post("/api/upload-gpx", upload.single("gpxFile"), (req, res) => {
  const {
    driver_name,
    vehicle_plate,
    start_time,
    end_time,
    start_lat,
    start_lon,
    end_lat,
    end_lon,
    distance,
    points,
  } = req.body;

  let file_name, gpxContent;

  // Handle drag-and-drop or form-uploaded files
  if (req.file) {
    file_name = req.file.originalname; // Extract file name from uploaded file
    gpxContent = req.file.buffer.toString(); // Read file content as string
  } else if (req.body.file_name) {
    // Handle existing API usage with file_name and metadata
    file_name = req.body.file_name;
  } else {
    return res.status(400).json({ error: "No GPX file provided." });
  }

  // 1) Check if file already exists
  const checkSql = `SELECT * FROM gpx_files WHERE file_name = ?`;
  db.get(checkSql, [file_name], (err, row) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "DB error during file check" });
    }

    if (row) {
      // File already exists
      return res.status(400).json({
        error: "File already exists",
        message: `The file ${file_name} has already been uploaded.`,
      });
    }

    // 2) Insert new file into gpx_files
    const insertFileSql = `INSERT INTO gpx_files (file_name) VALUES (?)`;
    db.run(insertFileSql, [file_name], function (err) {
      if (err) {
        if (err.message.includes("UNIQUE")) {
          return res.status(400).json({
            error: "File already exists",
            message: `The file ${file_name} has already been uploaded.`,
          });
        }
        console.error("Error inserting into gpx_files:", err);
        return res.status(500).json({ error: "DB error during file insertion" });
      }

      const gpxFileId = this.lastID;

      // 3) Insert driver into drivers table
      const insertDriverSql = `INSERT INTO drivers (name) VALUES (?)`;
      db.run(insertDriverSql, [driver_name], function (err) {
        if (err) {
          console.error("Error inserting driver:", err);
          return res.status(500).json({ error: "Error inserting driver" });
        }

        const driverId = this.lastID;

        // 4) Insert vehicle into vehicles table
        const insertVehicleSql = `INSERT INTO vehicles (license_plate) VALUES (?)`;
        db.run(insertVehicleSql, [vehicle_plate], function (err) {
          if (err) {
            console.error("Error inserting vehicle:", err);
            return res.status(500).json({ error: "Error inserting vehicle" });
          }

          const vehicleId = this.lastID;

          // 5) Insert trip into trips table
          const insertTripSql = `
            INSERT INTO trips (
              driver_id, vehicle_id,
              start_time, end_time,
              start_lat, start_lon,
              end_lat, end_lon,
              distance
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          db.run(
            insertTripSql,
            [
              driverId,
              vehicleId,
              start_time,
              end_time,
              start_lat,
              start_lon,
              end_lat,
              end_lon,
              distance,
            ],
            function (err) {
              if (err) {
                console.error("Error inserting trip:", err);
                return res.status(500).json({ error: "Error inserting trip" });
              }

              const tripId = this.lastID;

              // 6) Insert trip points into trip_points table
              if (Array.isArray(points)) {
                const insertPointSql = `
                  INSERT INTO trip_points (trip_id, lat, lon, timestamp)
                  VALUES (?, ?, ?, ?)
                `;
                const stmt = db.prepare(insertPointSql);
                points.forEach((pt) => {
                  stmt.run([tripId, pt.lat, pt.lon, pt.timestamp]);
                });
                stmt.finalize();
              }

              // Return success response
              return res.json({
                success: true,
                message: `File ${file_name} uploaded and processed successfully.`,
                trip_id: tripId,
              });
            }
          );
        });
      });
    });
  });
});


// Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
