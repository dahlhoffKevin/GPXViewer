// server/index.js

const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use(cors({ origin: "http://127.0.0.1:8080" }));

const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath);

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
      gpx_content TEXT,
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

app.post("/api/upload-gpx", async (req, res) => {
  const {
    file_name,
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
    gpx_content, // Include GPX data
  } = req.body;

  try {
    const fileExists = await checkFileExists(file_name);
    if (fileExists) {
      return res.status(400).json({
        error: "File already exists",
        message: `Die Datei ${file_name} wurde bereits hochgeladen.`,
      });
    }

    await insertFile(file_name, gpx_content);
    const driverId = await insertDriver(driver_name);
    const vehicleId = await insertVehicle(vehicle_plate);
    const tripId = await insertTrip(driverId, vehicleId, {
      start_time,
      end_time,
      start_lat,
      start_lon,
      end_lat,
      end_lon,
      distance,
    });

    if (Array.isArray(points)) {
      await insertTripPoints(tripId, points);
    }

    res.json({
      success: true,
      message: `Datei ${file_name} erfolgreich hochgeladen und verarbeitet.`,
      trip_id: tripId,
    });
  } catch (error) {
    console.error("Error during upload process:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


// Helper Functions
function checkFileExists(fileName) {
  const sql = `SELECT * FROM gpx_files WHERE file_name = ?`;
  return new Promise((resolve, reject) => {
    db.get(sql, [fileName], (err, row) => {
      if (err) return reject(err);
      resolve(!!row);
    });
  });
}

function insertFile(fileName, gpxContent) {
  const sql = `INSERT INTO gpx_files (file_name, gpx_content) VALUES (?, ?)`;
  return new Promise((resolve, reject) => {
    db.run(sql, [fileName, gpxContent], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function insertDriver(driverName) {
  const sql = `INSERT INTO drivers (name) VALUES (?)`;
  return new Promise((resolve, reject) => {
    db.run(sql, [driverName], function (err) {
      if (err) return reject(err);
      resolve(this.lastID);
    });
  });
}

function insertVehicle(vehiclePlate) {
  const sql = `INSERT INTO vehicles (license_plate) VALUES (?)`;
  return new Promise((resolve, reject) => {
    db.run(sql, [vehiclePlate], function (err) {
      if (err) return reject(err);
      resolve(this.lastID);
    });
  });
}

function insertTrip(driverId, vehicleId, tripData) {
  const sql = `
    INSERT INTO trips (
      driver_id, vehicle_id, start_time, end_time,
      start_lat, start_lon, end_lat, end_lon, distance
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    driverId,
    vehicleId,
    tripData.start_time,
    tripData.end_time,
    tripData.start_lat,
    tripData.start_lon,
    tripData.end_lat,
    tripData.end_lon,
    tripData.distance,
  ];

  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this.lastID);
    });
  });
}

function insertTripPoints(tripId, points) {
  const sql = `INSERT INTO trip_points (trip_id, lat, lon, timestamp) VALUES (?, ?, ?, ?)`;
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(sql);
    points.forEach((pt) => {
      stmt.run([tripId, pt.lat, pt.lon, pt.timestamp]);
    });
    stmt.finalize((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

app.get("/api/gpx-file", (req, res) => {
  const { fileName } = req.query;

  if (!fileName) {
    return res.status(400).json({ error: "Missing file name in query" });
  }

  const sql = `SELECT gpx_content FROM gpx_files WHERE file_name = ?`;
  db.get(sql, [fileName], (err, row) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!row || !row.gpx_content) {
      return res.status(404).json({ error: "File not found in database" });
    }

    res.type("application/xml");
    res.send(row.gpx_content);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
