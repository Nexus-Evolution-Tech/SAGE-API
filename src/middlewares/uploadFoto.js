const { v4: uuidv4 } = require('uuid');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const pasta = path.resolve(__dirname, '..', 'uploads');
if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, pasta),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const nomeTemporario = `temp_${uuidv4()}.png`;
    cb(null, nomeTemporario);
  }
});

module.exports = multer({ storage });
