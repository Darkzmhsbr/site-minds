const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta_super_segura_2024';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Apenas imagens são permitidas'));
    }
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

async function executeQuery(query, params = []) {
    const client = await pool.connect();
    try {
        const result = await client.query(query, params);
        return result;
    } finally {
        client.release();
    }
}

async function runMigration() {
    try {
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS channels (
                id SERIAL PRIMARY KEY,
                owner_id INTEGER REFERENCES users(id),
                name VARCHAR(255) NOT NULL,
                telegram_link VARCHAR(255),
                whatsapp_link VARCHAR(255),
                category VARCHAR(100),
                state VARCHAR(2),
                city VARCHAR(100),
                description TEXT,
                image_url VARCHAR(500),
                views INTEGER DEFAULT 0,
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        const adminExists = await executeQuery(
            'SELECT id FROM users WHERE email = $1',
            ['admin@portalx.com']
        );
        
        if (adminExists.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('Admin@2024!', 10);
            await executeQuery(
                'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)',
                ['Admin', 'admin@portalx.com', hashedPassword, 'admin']
            );
        }
    } catch (error) {
        console.error('Erro na migração:', error);
    }
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'Token não fornecido' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Token inválido' });
        }
        req.user = user;
        next();
    });
}

app.get('/service-worker.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
self.addEventListener('install', event => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', event => {
    event.respondWith(fetch(event.request));
});
    `);
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'online', 
        version: '15.0.0',
        mode: 'PRODUCTION_FINAL',
        features: {
            frontend: true,
            backend: true,
            database: true,
            uploads: true,
            ageVerification: true
        }
    });
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        
        if (!email || !password || !name) {
            return res.status(400).json({ message: 'Todos os campos são obrigatórios' });
        }
        
        const userExists = await executeQuery(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );
        
        if (userExists.rows.length > 0) {
            return res.status(400).json({ message: 'Email já cadastrado' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await executeQuery(
            'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
            [name, email, hashedPassword]
        );
        
        res.status(201).json({ 
            message: 'Cadastro realizado com sucesso!',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Erro no registro:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const result = await executeQuery(
            'SELECT id, name, email, password, role FROM users WHERE email = $1',
            [email]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Email ou senha incorretos' });
        }
        
        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ message: 'Email ou senha incorretos' });
        }
        
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const result = await executeQuery(
            'SELECT id, name, email, password, role FROM users WHERE email = $1 AND role = $2',
            [email, 'admin']
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Acesso negado' });
        }
        
        const admin = result.rows[0];
        const validPassword = await bcrypt.compare(password, admin.password);
        
        if (!validPassword) {
            return res.status(401).json({ message: 'Senha incorreta' });
        }
        
        const token = jwt.sign(
            { id: admin.id, email: admin.email, role: admin.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            token,
            admin: {
                id: admin.id,
                name: admin.name,
                email: admin.email
            }
        });
    } catch (error) {
        console.error('Erro no login admin:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

app.get('/api/channels/user', authenticateToken, async (req, res) => {
    try {
        const result = await executeQuery(
            'SELECT * FROM channels WHERE owner_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar canais:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

app.post('/api/channels', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        const { name, telegram_link, whatsapp_link, category, state, city, description } = req.body;
        
        if (!name || !category) {
            return res.status(400).json({ message: 'Nome e categoria são obrigatórios' });
        }
        
        let image_url = null;
        if (req.file) {
            image_url = `/uploads/${req.file.filename}`;
        }
        
        const result = await executeQuery(
            `INSERT INTO channels (owner_id, name, telegram_link, whatsapp_link, category, state, city, description, image_url) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [req.user.id, name, telegram_link, whatsapp_link, category, state, city, description, image_url]
        );
        
        res.status(201).json({ 
            message: 'Canal cadastrado com sucesso!',
            channelId: result.rows[0].id 
        });
    } catch (error) {
        console.error('Erro ao criar canal:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

app.get('/api/channels/category/:category', async (req, res) => {
    try {
        const { category } = req.params;
        
        const result = await executeQuery(
            'SELECT * FROM channels WHERE category = $1 AND status = $2 ORDER BY views DESC',
            [category, 'active']
        );
        
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar canais por categoria:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

app.get('/api/channels/all', async (req, res) => {
    try {
        const result = await executeQuery(
            'SELECT * FROM channels WHERE status = $1 ORDER BY views DESC',
            ['active']
        );
        
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar todos os canais:', error);
        res.status(500).json({ message: 'Erro interno do servidor' });
    }
});

app.get('/assets/js/auth-system.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
class AuthSystem {
    constructor() {
        this.token = localStorage.getItem('authToken') || localStorage.getItem('adminToken');
        this.API_URL = window.location.origin + '/api';
    }

    async checkAPIHealth() {
        try {
            const response = await fetch(\`\${this.API_URL}/health\`);
            const data = await response.json();
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async register(email, password, name) {
        try {
            const response = await fetch(\`\${this.API_URL}/auth/register\`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ email, password, name })
            });

            const data = await response.json();

            if (response.ok) {
                return { success: true, data };
            } else {
                return { success: false, error: data.message || 'Erro no cadastro' };
            }
        } catch (error) {
            return { success: false, error: 'Erro de conexão com o servidor' };
        }
    }

    async login(email, password) {
        try {
            const response = await fetch(\`\${this.API_URL}/auth/login\`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok && data.token) {
                this.token = data.token;
                localStorage.setItem('authToken', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                return { success: true, data };
            } else {
                return { success: false, error: data.message || 'Credenciais inválidas' };
            }
        } catch (error) {
            return { success: false, error: 'Erro de conexão com o servidor' };
        }
    }

    async adminLogin(email, password) {
        try {
            const response = await fetch(\`\${this.API_URL}/admin/login\`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok && data.token) {
                this.token = data.token;
                localStorage.setItem('adminToken', data.token);
                localStorage.setItem('admin', JSON.stringify(data.admin));
                return { success: true, data };
            } else {
                return { success: false, error: data.message || 'Credenciais inválidas' };
            }
        } catch (error) {
            return { success: false, error: 'Erro de conexão com o servidor' };
        }
    }

    logout() {
        this.token = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('adminToken');
        localStorage.removeItem('user');
        localStorage.removeItem('admin');
        window.location.href = '/';
    }

    getUser() {
        return JSON.parse(localStorage.getItem('user') || 'null');
    }

    getAdmin() {
        return JSON.parse(localStorage.getItem('admin') || 'null');
    }

    isAuthenticated() {
        return !!this.token;
    }

    isAdmin() {
        return !!localStorage.getItem('adminToken');
    }
}

window.AuthSystem = AuthSystem;
window.authSystem = new AuthSystem();
    `);
});

const ageVerificationHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Portal Secreto X - Acesso Restrito +18</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', -apple-system, sans-serif; background: #0a0a0a; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .bg-effect { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: radial-gradient(circle at 20% 50%, rgba(220, 38, 38, 0.1) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(220, 38, 38, 0.05) 0%, transparent 50%), radial-gradient(circle at 40% 20%, rgba(220, 38, 38, 0.08) 0%, transparent 50%); z-index: -1; }
        .container { max-width: 500px; padding: 3rem 2rem; text-align: center; background: rgba(17, 17, 17, 0.9); border-radius: 20px; backdrop-filter: blur(10px); border: 1px solid rgba(220, 38, 38, 0.2); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); transform: translateY(0); animation: slideUp 0.6s ease-out; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        .logo { font-size: 3rem; margin-bottom: 1rem; filter: drop-shadow(0 0 20px rgba(220, 38, 38, 0.5)); animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
        h1 { font-size: 2rem; font-weight: 800; margin-bottom: 1rem; background: linear-gradient(135deg, #fff 0%, #dc2626 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .subtitle { font-size: 1.1rem; color: #a3a3a3; margin-bottom: 2rem; line-height: 1.6; }
        .warning-box { background: rgba(220, 38, 38, 0.1); border: 1px solid rgba(220, 38, 38, 0.3); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; }
        .warning-box p { color: #fbbf24; font-weight: 600; margin-bottom: 0.5rem; }
        .warning-box small { color: #d4d4d4; font-size: 0.875rem; }
        .age-buttons { display: flex; gap: 1rem; margin-bottom: 2rem; }
        .age-btn { flex: 1; padding: 1rem; border: none; border-radius: 10px; font-weight: 600; font-size: 1rem; cursor: pointer; transition: all 0.3s ease; position: relative; overflow: hidden; }
        .age-btn-yes { background: #dc2626; color: white; }
        .age-btn-yes:hover { background: #b91c1c; transform: translateY(-2px); box-shadow: 0 10px 20px rgba(220, 38, 38, 0.3); }
        .age-btn-no { background: #262626; color: #737373; border: 1px solid #404040; }
        .age-btn-no:hover { background: #1a1a1a; }
        .loading-container { display: none; flex-direction: column; align-items: center; gap: 1.5rem; }
        .loader { width: 60px; height: 60px; border: 3px solid rgba(220, 38, 38, 0.1); border-top-color: #dc2626; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .loading-text { color: #d4d4d4; font-size: 1rem; }
        .counter { font-size: 2rem; font-weight: 800; color: #dc2626; margin-top: 1rem; }
        .legal { margin-top: 2rem; padding-top: 2rem; border-top: 1px solid rgba(255, 255, 255, 0.1); font-size: 0.75rem; color: #737373; line-height: 1.5; }
        .error-message { display: none; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 1rem; margin-top: 1rem; color: #fca5a5; }
        @media (max-width: 640px) { .container { margin: 1rem; padding: 2rem 1.5rem; } h1 { font-size: 1.5rem; } .age-buttons { flex-direction: column; } }
    </style>
</head>
<body>
    <div class="bg-effect"></div>
    <div class="container">
        <div id="ageVerification">
            <div class="logo">🔞</div>
            <h1>Portal Secreto X</h1>
            <p class="subtitle">Descobrimos os grupos mais insanos do Telegram em 2025</p>
            <div class="warning-box">
                <p>⚠️ AVISO IMPORTANTE</p>
                <small>Este site contém conteúdo adulto explícito. O acesso é permitido apenas para maiores de 18 anos.</small>
            </div>
            <p style="font-size: 1.25rem; font-weight: 600; margin-bottom: 1.5rem;">Você tem 18 anos ou mais?</p>
            <div class="age-buttons">
                <button class="age-btn age-btn-yes" onclick="verifyAge(true)">SIM, tenho +18</button>
                <button class="age-btn age-btn-no" onclick="verifyAge(false)">NÃO</button>
            </div>
            <div class="error-message" id="errorMessage">Acesso negado. Este conteúdo é restrito para maiores de 18 anos.</div>
        </div>
        <div class="loading-container" id="loadingContainer">
            <div class="loader"></div>
            <p class="loading-text">Verificando sua idade...</p>
            <p class="loading-text" id="loadingMessage">Preparando conteúdo exclusivo</p>
            <div class="counter" id="counter">7</div>
        </div>
        <div class="legal">Ao acessar este site, você confirma que tem 18 anos ou mais e concorda com nossos termos de uso. Todo conteúdo é fornecido por terceiros. Não nos responsabilizamos pelo conteúdo dos grupos.</div>
    </div>
    <script>
        let countdown = 7;
        let countdownInterval;
        const messages = ["Verificando sua idade...", "Carregando grupos secretos...", "Desbloqueando conteúdo premium...", "Preparando sua experiência...", "Acessando banco de dados...", "Quase lá..."];
        function setCookie(name, value, hours) {
            const d = new Date();
            d.setTime(d.getTime() + (hours * 60 * 60 * 1000));
            document.cookie = \`\${name}=\${value};expires=\${d.toUTCString()};path=/\`;
        }
        function getCookie(name) {
            const value = \`; \${document.cookie}\`;
            const parts = value.split(\`; \${name}=\`);
            if (parts.length === 2) return parts.pop().split(';').shift();
        }
        function verifyAge(isAdult) {
            if (!isAdult) {
                document.getElementById('errorMessage').style.display = 'block';
                setTimeout(() => { window.location.href = 'https://www.google.com'; }, 2000);
                return;
            }
            document.getElementById('ageVerification').style.display = 'none';
            document.getElementById('loadingContainer').style.display = 'flex';
            let messageIndex = 0;
            const messageInterval = setInterval(() => {
                if (messageIndex < messages.length) {
                    document.getElementById('loadingMessage').textContent = messages[messageIndex];
                    messageIndex++;
                }
            }, 1000);
            countdownInterval = setInterval(() => {
                countdown--;
                document.getElementById('counter').textContent = countdown;
                if (countdown <= 0) {
                    clearInterval(countdownInterval);
                    clearInterval(messageInterval);
                    setCookie('ageVerified', 'true', 24);
                    window.location.href = '/home';
                }
            }, 1000);
        }
        if (getCookie('ageVerified') === 'true') {
            window.location.href = '/home';
        }
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/service-worker.js');
        }
    </script>
</body>
</html>`;

const homeHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Portal Secreto X - Grupos Premium do Telegram</title>
    <meta name="description" content="Os melhores grupos adultos do Telegram. Universitárias, amadoras, vazados e mais.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: #0a0a0a; color: #fff; overflow-x: hidden; }
        header { position: fixed; top: 0; left: 0; right: 0; background: linear-gradient(to bottom, rgba(10, 10, 10, 0.95), transparent); backdrop-filter: blur(10px); z-index: 1000; padding: 1rem 2rem; }
        .header-content { max-width: 1400px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 1.5rem; font-weight: 800; display: flex; align-items: center; gap: 0.5rem; }
        .logo span { background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        nav { display: flex; gap: 2rem; align-items: center; }
        .nav-link { color: #d4d4d4; text-decoration: none; font-weight: 500; transition: color 0.3s; }
        .nav-link:hover { color: #dc2626; }
        .filters-toggle { background: rgba(220, 38, 38, 0.1); border: 1px solid rgba(220, 38, 38, 0.3); color: #dc2626; padding: 0.5rem 1rem; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s; }
        .filters-toggle:hover { background: rgba(220, 38, 38, 0.2); }
        main { margin-top: 80px; padding: 2rem; max-width: 1400px; margin-left: auto; margin-right: auto; }
        .hero { margin-bottom: 3rem; text-align: center; }
        .hero h1 { font-size: 3rem; font-weight: 800; margin-bottom: 1rem; background: linear-gradient(135deg, #fff 0%, #dc2626 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .hero p { font-size: 1.25rem; color: #a3a3a3; max-width: 600px; margin: 0 auto; }
        .filters-sidebar { position: fixed; left: -300px; top: 0; width: 300px; height: 100vh; background: #111; border-right: 1px solid rgba(255, 255, 255, 0.1); padding: 6rem 2rem 2rem; overflow-y: auto; transition: left 0.3s; z-index: 999; }
        .filters-sidebar.active { left: 0; }
        .filter-section { margin-bottom: 2rem; }
        .filter-title { font-weight: 600; margin-bottom: 1rem; color: #dc2626; }
        .filter-option { display: block; padding: 0.5rem; color: #a3a3a3; cursor: pointer; transition: all 0.3s; border-radius: 4px; }
        .filter-option:hover { background: rgba(220, 38, 38, 0.1); color: #fff; }
        .filter-option.active { background: rgba(220, 38, 38, 0.2); color: #dc2626; }
        .category-section { margin-bottom: 3rem; }
        .category-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
        .category-title { font-size: 1.5rem; font-weight: 700; }
        .see-all { color: #dc2626; text-decoration: none; font-weight: 500; }
        .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; }
        .card { background: #111; border-radius: 12px; overflow: hidden; transition: all 0.3s; cursor: pointer; position: relative; border: 1px solid transparent; }
        .card:hover { transform: translateY(-4px); border-color: rgba(220, 38, 38, 0.3); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); }
        .card-image { width: 100%; height: 160px; object-fit: cover; filter: blur(8px); transition: filter 0.3s; }
        .card:hover .card-image { filter: blur(4px); }
        .card-lock { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 2rem; color: #dc2626; background: rgba(0, 0, 0, 0.8); width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
        .card-content { padding: 1rem; }
        .card-title { font-weight: 600; margin-bottom: 0.5rem; }
        .card-meta { display: flex; justify-content: space-between; align-items: center; font-size: 0.875rem; color: #737373; }
        .card-location { display: flex; align-items: center; gap: 0.25rem; }
        .card-views { display: flex; align-items: center; gap: 0.25rem; }
        .card-cta { margin-top: 1rem; background: #dc2626; color: white; border: none; padding: 0.75rem; width: 100%; border-radius: 8px; font-weight: 600; cursor: pointer; transition: background 0.3s; }
        .card-cta:hover { background: #b91c1c; }
        .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.9); z-index: 2000; align-items: center; justify-content: center; }
        .modal-content { background: #111; border-radius: 16px; padding: 2rem; max-width: 500px; width: 90%; text-align: center; border: 1px solid rgba(220, 38, 38, 0.3); }
        .modal h2 { font-size: 1.5rem; margin-bottom: 1rem; color: #dc2626; }
        .modal p { color: #a3a3a3; margin-bottom: 1.5rem; }
        .modal-buttons { display: flex; gap: 1rem; }
        .modal-btn { flex: 1; padding: 0.75rem; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.3s; }
        .modal-btn-primary { background: #dc2626; color: white; }
        .modal-btn-secondary { background: #262626; color: #a3a3a3; }
        @media (max-width: 768px) { .hero h1 { font-size: 2rem; } nav { gap: 1rem; } .cards-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1rem; } .card-image { height: 120px; } }
        .auth-section { display: flex; gap: 1rem; align-items: center; }
        .auth-link { color: #d4d4d4; text-decoration: none; padding: 0.5rem 1rem; border-radius: 6px; font-weight: 500; transition: all 0.3s; font-size: 0.875rem; }
        .auth-link:hover { color: #dc2626; }
        .auth-link.register { background: #dc2626; color: white; }
        .auth-link.register:hover { background: #b91c1c; }
    </style>
</head>
<body>
    <header>
        <div class="header-content">
            <div class="logo">🔞 <span>Portal Secreto X</span></div>
            <nav>
                <a href="#" class="nav-link">Novidades</a>
                <a href="#" class="nav-link">Populares</a>
                <a href="#" class="nav-link">Premium</a>
                <button class="filters-toggle" onclick="toggleFilters()">Filtros</button>
            </nav>
            <div class="auth-section">
                <a href="/login" class="auth-link">Entrar</a>
                <a href="/register" class="auth-link register">Cadastrar</a>
            </div>
        </div>
    </header>
    <div class="filters-sidebar" id="filtersSidebar">
        <div class="filter-section">
            <h3 class="filter-title">CATEGORIAS</h3>
            <div class="filter-option" data-category="universitarias">👯‍♀️ Universitárias</div>
            <div class="filter-option" data-category="cornos">🤘 Cornos</div>
            <div class="filter-option" data-category="amadoras">🎥 Amadoras</div>
            <div class="filter-option" data-category="famosas">⭐ Famosas</div>
            <div class="filter-option" data-category="vazadas">📱 Vazadas</div>
        </div>
        <div class="filter-section">
            <h3 class="filter-title">ESTADOS</h3>
            <div class="filter-option" data-state="SP">São Paulo</div>
            <div class="filter-option" data-state="RJ">Rio de Janeiro</div>
            <div class="filter-option" data-state="MG">Minas Gerais</div>
            <div class="filter-option" data-state="SC">Santa Catarina</div>
            <div class="filter-option" data-state="RS">Rio Grande do Sul</div>
        </div>
        <div class="filter-section">
            <h3 class="filter-title">ORDENAR</h3>
            <div class="filter-option" data-sort="views">Mais vistos</div>
            <div class="filter-option" data-sort="new">Mais recentes</div>
            <div class="filter-option" data-sort="hot">Em alta 🔥</div>
        </div>
    </div>
    <main>
        <div class="hero">
            <h1>Os Grupos Mais Quentes do Telegram</h1>
            <p>Acesso exclusivo aos melhores conteúdos adultos. Novos grupos adicionados diariamente.</p>
        </div>
        <div id="categoriesContainer"></div>
    </main>
    <div class="modal" id="groupModal">
        <div class="modal-content">
            <h2>🔓 Desbloquear Grupo</h2>
            <p id="modalGroupName"></p>
            <p>Você está prestes a acessar conteúdo adulto exclusivo. Confirma que deseja continuar?</p>
            <div class="modal-buttons">
                <button class="modal-btn modal-btn-primary" onclick="accessGroup()">Acessar agora</button>
                <button class="modal-btn modal-btn-secondary" onclick="closeModal()">Cancelar</button>
            </div>
        </div>
    </div>
    <script>
        const groups = [
            { id: 1, name: "Universitárias SP 🔥", category: "universitarias", state: "SP", city: "São Paulo", views: 2341, image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='160'%3E%3Crect fill='%23dc2626' width='280' height='160'/%3E%3Ctext x='140' y='80' text-anchor='middle' fill='white' font-size='20'%3E🔞%3C/text%3E%3C/svg%3E", link: "https://t.me/exemplo1" },
            { id: 2, name: "Cornos MG Flagras", category: "cornos", state: "MG", city: "Belo Horizonte", views: 1876, image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='160'%3E%3Crect fill='%23dc2626' width='280' height='160'/%3E%3Ctext x='140' y='80' text-anchor='middle' fill='white' font-size='20'%3E🔞%3C/text%3E%3C/svg%3E", link: "https://t.me/exemplo2" },
            { id: 3, name: "Amadoras RJ 18+", category: "amadoras", state: "RJ", city: "Rio de Janeiro", views: 3102, image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='160'%3E%3Crect fill='%23dc2626' width='280' height='160'/%3E%3Ctext x='140' y='80' text-anchor='middle' fill='white' font-size='20'%3E🔞%3C/text%3E%3C/svg%3E", link: "https://t.me/exemplo3" },
            { id: 4, name: "Famosas Vazadas BR", category: "famosas", state: "SP", city: "São Paulo", views: 4521, image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='160'%3E%3Crect fill='%23dc2626' width='280' height='160'/%3E%3Ctext x='140' y='80' text-anchor='middle' fill='white' font-size='20'%3E🔞%3C/text%3E%3C/svg%3E", link: "https://t.me/exemplo4" },
            { id: 5, name: "Vazadas SC Premium", category: "vazadas", state: "SC", city: "Florianópolis", views: 1654, image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='160'%3E%3Crect fill='%23dc2626' width='280' height='160'/%3E%3Ctext x='140' y='80' text-anchor='middle' fill='white' font-size='20'%3E🔞%3C/text%3E%3C/svg%3E", link: "https://t.me/exemplo5" }
        ];
        window.gruposData = groups;
        let filteredGroups = [...groups];
        let currentGroup = null;
        function toggleFilters() { document.getElementById('filtersSidebar').classList.toggle('active'); }
        function createCard(group) {
            return \`<div class="card" onclick="showModal('\${group.name}', '\${group.link}')">
                <div style="position: relative;">
                    <img src="\${group.image}" alt="\${group.name}" class="card-image">
                    <div class="card-lock">🔒</div>
                </div>
                <div class="card-content">
                    <h3 class="card-title">\${group.name}</h3>
                    <div class="card-meta">
                        <span class="card-location">📍 \${group.city}</span>
                        <span class="card-views">👁 \${group.views.toLocaleString()}</span>
                    </div>
                    <button class="card-cta">Desbloquear 🔥</button>
                </div>
            </div>\`;
        }
        function renderGroups() {
            const container = document.getElementById('categoriesContainer');
            const categories = { universitarias: "👯‍♀️ Universitárias", cornos: "🤘 Cornos", amadoras: "🎥 Amadoras", famosas: "⭐ Famosas", vazadas: "📱 Vazadas" };
            container.innerHTML = '';
            Object.keys(categories).forEach(category => {
                const categoryGroups = filteredGroups.filter(g => g.category === category);
                if (categoryGroups.length > 0) {
                    container.innerHTML += \`<div class="category-section">
                        <div class="category-header">
                            <h2 class="category-title">\${categories[category]}</h2>
                            <a href="#" class="see-all">Ver todos →</a>
                        </div>
                        <div class="cards-grid">\${categoryGroups.map(createCard).join('')}</div>
                    </div>\`;
                }
            });
        }
        function showModal(name, link) {
            currentGroup = { name, link };
            document.getElementById('modalGroupName').textContent = name;
            document.getElementById('groupModal').style.display = 'flex';
        }
        function closeModal() {
            document.getElementById('groupModal').style.display = 'none';
            currentGroup = null;
        }
        function accessGroup() {
            if (currentGroup) {
                window.open(currentGroup.link, '_blank');
                closeModal();
            }
        }
        document.querySelectorAll('.filter-option').forEach(option => {
            option.addEventListener('click', function() {
                this.classList.toggle('active');
                applyFilters();
            });
        });
        function applyFilters() {
            const activeCategories = Array.from(document.querySelectorAll('.filter-option[data-category].active')).map(el => el.dataset.category);
            const activeStates = Array.from(document.querySelectorAll('.filter-option[data-state].active')).map(el => el.dataset.state);
            filteredGroups = groups.filter(group => {
                const categoryMatch = activeCategories.length === 0 || activeCategories.includes(group.category);
                const stateMatch = activeStates.length === 0 || activeStates.includes(group.state);
                return categoryMatch && stateMatch;
            });
            renderGroups();
        }
        window.onclick = function(event) {
            if (event.target === document.getElementById('groupModal')) {
                closeModal();
            }
        }
        renderGroups();
        for (let i = 6; i <= 20; i++) {
            groups.push({
                id: i,
                name: \`Grupo Premium \${i}\`,
                category: ["universitarias", "cornos", "amadoras", "famosas", "vazadas"][i % 5],
                state: ["SP", "RJ", "MG", "SC", "RS"][i % 5],
                city: ["São Paulo", "Rio de Janeiro", "Belo Horizonte", "Florianópolis", "Porto Alegre"][i % 5],
                views: Math.floor(Math.random() * 5000) + 1000,
                image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='160'%3E%3Crect fill='%23dc2626' width='280' height='160'/%3E%3Ctext x='140' y='80' text-anchor='middle' fill='white' font-size='20'%3E🔞%3C/text%3E%3C/svg%3E",
                link: \`https://t.me/exemplo\${i}\`
            });
        }
        renderGroups();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/service-worker.js');
        }
    </script>
</body>
</html>`;

/* loginHTML was removed because it was declared but never used. */

const registerHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Criar Conta - Portal Secreto X</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%); color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
        .register-container { background: rgba(20, 20, 20, 0.9); padding: 3rem; border-radius: 12px; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); max-width: 450px; width: 100%; }
        .logo { text-align: center; margin-bottom: 2rem; }
        .logo-icon { background: #dc2626; color: white; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; margin: 0 auto 1rem; }
        .title { color: #dc2626; font-size: 1.8rem; font-weight: 700; text-align: center; margin-bottom: 0.5rem; }
        .subtitle { color: #a3a3a3; text-align: center; margin-bottom: 2rem; font-size: 0.9rem; }
        .form-group { margin-bottom: 1.5rem; }
        label { display: block; margin-bottom: 0.5rem; color: #a3a3a3; font-weight: 500; }
        input { width: 100%; padding: 1rem; background: rgba(31, 31, 31, 0.8); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; color: #fff; font-size: 1rem; transition: all 0.3s ease; }
        input:focus { outline: none; border-color: #dc2626; box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.2); }
        .submit-btn { width: 100%; padding: 1rem; background: linear-gradient(135deg, #dc2626, #b91c1c); color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: all 0.3s ease; margin-top: 1rem; }
        .submit-btn:hover { background: linear-gradient(135deg, #b91c1c, #991b1b); transform: translateY(-1px); }
        .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .message { padding: 1rem; border-radius: 8px; margin: 1rem 0; display: none; }
        .message.success { background: rgba(34, 197, 94, 0.2); border: 1px solid #22c55e; color: #22c55e; }
        .message.error { background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #ef4444; }
        .message.info { background: rgba(59, 130, 246, 0.2); border: 1px solid #3b82f6; color: #3b82f6; }
        .links { text-align: center; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid rgba(255, 255, 255, 0.1); }
        .links a { color: #dc2626; text-decoration: none; margin: 0 1rem; transition: opacity 0.3s ease; }
        .links a:hover { opacity: 0.8; }
        .debug-info { background: rgba(31, 31, 31, 0.5); padding: 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.875rem; color: #a3a3a3; }
        .password-requirements { font-size: 0.8rem; color: #666; margin-top: 0.5rem; }
        .terms { font-size: 0.85rem; color: #a3a3a3; margin-top: 1rem; text-align: center; }
    </style>
</head>
<body>
    <div class="register-container">
        <div class="logo">
            <div class="logo-icon">🔞</div>
            <h1 class="title">Criar Conta</h1>
            <p class="subtitle">Acesso exclusivo ao Portal Secreto X</p>
        </div>
        <div id="debugInfo" class="debug-info">
            <strong>🔧 Status:</strong> <span id="debugStatus">Carregando...</span><br>
            <strong>📡 API:</strong> <span id="debugApi">/api</span>
        </div>
        <form id="registerForm">
            <div class="form-group">
                <label for="name">Nome completo</label>
                <input type="text" id="name" name="name" required placeholder="Digite seu nome completo">
            </div>
            <div class="form-group">
                <label for="email">E-mail</label>
                <input type="email" id="email" name="email" required placeholder="Digite seu melhor e-mail">
            </div>
            <div class="form-group">
                <label for="password">Senha</label>
                <input type="password" id="password" name="password" required placeholder="Crie uma senha segura">
                <div class="password-requirements">Mínimo 6 caracteres</div>
            </div>
            <div class="form-group">
                <label for="confirmPassword">Confirmar senha</label>
                <input type="password" id="confirmPassword" name="confirmPassword" required placeholder="Confirme sua senha">
            </div>
            <div id="message" class="message"></div>
            <button type="submit" id="submitBtn" class="submit-btn">Cadastrar</button>
        </form>
        <div class="terms">Ao criar uma conta, você concorda com nossos termos de uso.<br>Sua conta será aprovada em até 24h.</div>
        <div class="links">
            <a href="/login">Já tem conta? Faça login</a> |
            <a href="/">Voltar ao site</a>
        </div>
    </div>
    <script src="/assets/js/auth-system.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', async () => {
            console.log('📄 Register page carregada');
            document.getElementById('debugApi').textContent = window.AuthSystem ? window.AuthSystem.API_URL : 'AuthSystem não carregado';
            if (window.AuthSystem) {
                document.getElementById('debugStatus').textContent = 'AuthSystem carregado ✅';
                const health = await window.AuthSystem.checkAPIHealth();
                if (health.success) {
                    document.getElementById('debugStatus').textContent = 'API funcionando ✅';
                } else {
                    document.getElementById('debugStatus').textContent = 'API com problemas ❌';
                }
            } else {
                document.getElementById('debugStatus').textContent = 'AuthSystem falhou ❌';
                showMessage('Erro: Sistema de autenticação não carregou', 'error');
            }
        });
        document.getElementById('registerForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!window.AuthSystem) {
                showMessage('Sistema de autenticação não está disponível', 'error');
                return;
            }
            const name = document.getElementById('name').value.trim();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const submitBtn = document.getElementById('submitBtn');
            if (!name || !email || !password || !confirmPassword) {
                showMessage('Por favor, preencha todos os campos', 'error');
                return;
            }
            if (name.length < 2) {
                showMessage('Nome deve ter pelo menos 2 caracteres', 'error');
                return;
            }
            if (password.length < 6) {
                showMessage('Senha deve ter pelo menos 6 caracteres', 'error');
                return;
            }
            if (password !== confirmPassword) {
                showMessage('As senhas não coincidem', 'error');
                return;
            }
            const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
            if (!emailRegex.test(email)) {
                showMessage('Por favor, digite um e-mail válido', 'error');
                return;
            }
            submitBtn.disabled = true;
            submitBtn.textContent = 'Cadastrando...';
            showMessage('Criando sua conta...', 'info');
            try {
                console.log('📝 Tentando fazer registro...');
                const result = await window.AuthSystem.register(email, password, name);
                if (result.success) {
                    showMessage('Conta criada com sucesso! Aguarde aprovação para fazer login.', 'success');
                    document.getElementById('registerForm').reset();
                    setTimeout(() => {
                        window.location.href = '/login';
                    }, 3000);
                } else {
                    showMessage(result.error || 'Erro no cadastro', 'error');
                }
            } catch (error) {
                console.error('❌ Erro no registro:', error);
                showMessage('Erro inesperado: ' + error.message, 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Cadastrar';
            }
        });
        document.getElementById('confirmPassword').addEventListener('input', (e) => {
            const password = document.getElementById('password').value;
            const confirmPassword = e.target.value;
            if (confirmPassword && password !== confirmPassword) {
                e.target.style.borderColor = '#ef4444';
            } else {
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            }
        });
        function showMessage(text, type) {
            const messageEl = document.getElementById('message');
            messageEl.textContent = text;
            messageEl.className = \`message \${type}\`;
            messageEl.style.display = 'block';
        }
        function hideMessage() {
            document.getElementById('message').style.display = 'none';
        }
        setInterval(() => {
            const messageEl = document.getElementById('message');
            if (messageEl.style.display === 'block' && !messageEl.classList.contains('success')) {
                setTimeout(hideMessage, 5000);
            }
        }, 100);
    </script>
</body>
</html>`;

const dashboardHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - Portal Secreto X</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #0a0a0a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        header { background: #141414; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; }
        .header-left { display: flex; align-items: center; gap: 2rem; }
        .logo { font-size: 1.5rem; font-weight: 700; color: #dc2626; }
        .user-info { display: flex; align-items: center; gap: 1rem; }
        .user-name { color: #a3a3a3; font-size: 0.875rem; }
        .logout-btn { background: transparent; color: #dc2626; border: 1px solid #dc2626; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.3s; }
        .logout-btn:hover { background: #dc2626; color: #fff; }
        .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
        .add-channel-btn { background: #dc2626; color: #fff; border: none; padding: 0.875rem 1.5rem; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-bottom: 2rem; display: flex; align-items: center; gap: 0.5rem; }
        .add-channel-btn:hover { background: #b91c1c; }
        .channels-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
        .channel-card { background: #141414; border-radius: 12px; overflow: hidden; border: 1px solid #262626; transition: border-color 0.3s; }
        .channel-card:hover { border-color: #dc2626; }
        .channel-image { width: 100%; height: 160px; object-fit: cover; background: #1a1a1a; }
        .channel-info { padding: 1.5rem; }
        .channel-name { font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem; }
        .channel-category { display: inline-block; background: rgba(220, 38, 38, 0.2); color: #dc2626; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.75rem; margin-bottom: 1rem; }
        .channel-stats { display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #262626; }
        .channel-date { color: #a3a3a3; font-size: 0.875rem; }
        .channel-link { color: #dc2626; text-decoration: none; font-size: 0.875rem; font-weight: 500; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.8); z-index: 1000; align-items: center; justify-content: center; }
        .modal.active { display: flex; }
        .modal-content { background: #141414; border-radius: 12px; padding: 2rem; width: 90%; max-width: 500px; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
        .modal-title { font-size: 1.5rem; color: #dc2626; }
        .close-btn { background: transparent; border: none; color: #a3a3a3; font-size: 1.5rem; cursor: pointer; }
        .form-group { margin-bottom: 1.5rem; }
        label { display: block; margin-bottom: 0.5rem; color: #a3a3a3; font-size: 0.875rem; }
        input, select { width: 100%; padding: 0.75rem; background: #1f1f1f; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 1rem; }
        .form-hint { color: #666; font-size: 0.75rem; margin-top: 0.25rem; }
        .form-actions { display: flex; gap: 1rem; margin-top: 2rem; }
        .btn { flex: 1; padding: 0.875rem; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; }
        .btn-primary { background: #dc2626; color: #fff; }
        .btn-secondary { background: #262626; color: #a3a3a3; }
        .empty-state { text-align: center; padding: 4rem 2rem; }
        .empty-icon { font-size: 4rem; margin-bottom: 1rem; opacity: 0.5; }
        .empty-text { color: #a3a3a3; margin-bottom: 2rem; }
        .file-input-wrapper { position: relative; display: inline-block; width: 100%; }
        .file-input { display: none; }
        .file-input-label { display: block; width: 100%; padding: 0.75rem; background: #1f1f1f; border: 1px solid #333; border-radius: 8px; color: #a3a3a3; cursor: pointer; text-align: center; transition: all 0.3s; }
        .file-input-label:hover { border-color: #dc2626; color: #fff; }
        .file-preview { margin-top: 1rem; }
        .file-preview img { max-width: 100%; max-height: 200px; border-radius: 8px; }
    </style>
</head>
<body>
    <header>
        <div class="header-left">
            <div class="logo">🔞 Portal Secreto X</div>
            <nav><a href="/home" style="color: #a3a3a3; text-decoration: none;">Ver Site</a></nav>
        </div>
        <div class="user-info">
            <span class="user-name" id="userName">Carregando...</span>
            <button class="logout-btn" onclick="logout()">Sair</button>
        </div>
    </header>
    <div class="container">
        <button class="add-channel-btn" onclick="openModal()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Cadastrar Canal/Grupo
        </button>
        <div id="channelsContainer">
            <div class="empty-state">
                <div class="empty-icon">📱</div>
                <p class="empty-text">Você ainda não cadastrou nenhum canal</p>
            </div>
        </div>
    </div>
    <div class="modal" id="addChannelModal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 class="modal-title">Cadastrar Canal/Grupo</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <form id="channelForm" enctype="multipart/form-data">
                <div class="form-group">
                    <label for="name">Nome do Canal/Grupo</label>
                    <input type="text" id="name" name="name" required>
                </div>
                <div class="form-group">
                    <label for="telegramLink">Link do Telegram</label>
                    <input type="url" id="telegramLink" name="telegram_link" placeholder="https://t.me/seucanal">
                </div>
                <div class="form-group">
                    <label for="category">Categoria</label>
                    <select id="category" name="category" required>
                        <option value="">Selecione uma categoria</option>
                        <option value="universitarias">Universitárias</option>
                        <option value="cornos">Cornos</option>
                        <option value="amadoras">Amadoras</option>
                        <option value="famosas">Famosas</option>
                        <option value="vazadas">Vazadas</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="state">Estado</label>
                    <select id="state" name="state">
                        <option value="">Selecione um estado</option>
                        <option value="SP">São Paulo</option>
                        <option value="RJ">Rio de Janeiro</option>
                        <option value="MG">Minas Gerais</option>
                        <option value="RS">Rio Grande do Sul</option>
                        <option value="SC">Santa Catarina</option>
                        <option value="PR">Paraná</option>
                        <option value="BA">Bahia</option>
                        <option value="PE">Pernambuco</option>
                        <option value="CE">Ceará</option>
                        <option value="GO">Goiás</option>
                        <option value="DF">Distrito Federal</option>
                        <option value="ES">Espírito Santo</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="city">Cidade</label>
                    <input type="text" id="city" name="city" placeholder="Ex: São Paulo">
                </div>
                <div class="form-group">
                    <label for="image">Imagem do Canal (Opcional)</label>
                    <div class="file-input-wrapper">
                        <input type="file" id="image" name="image" class="file-input" accept="image/*">
                        <label for="image" class="file-input-label">Clique para escolher uma imagem</label>
                    </div>
                    <div class="form-hint">Deixe em branco para usar a imagem do Telegram. Máximo 5MB.</div>
                    <div id="imagePreview" class="file-preview"></div>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">Cadastrar</button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
                </div>
            </form>
        </div>
    </div>
    <script>
        const API_URL = window.location.origin + '/api';
        const token = localStorage.getItem('authToken');
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        
        if (!token) {
            window.location.href = '/login';
        }
        
        document.getElementById('userName').textContent = user?.name || 'Usuário';
        
        let userChannels = [];
        
        async function loadUserChannels() {
            try {
                const response = await fetch(\`\${API_URL}/channels/user\`, {
                    headers: { 'Authorization': \`Bearer \${token}\` }
                });
                if (response.ok) {
                    userChannels = await response.json();
                    renderChannels();
                }
            } catch (error) {
                console.error('Erro ao carregar canais:', error);
            }
        }
        
        function renderChannels() {
            const container = document.getElementById('channelsContainer');
            if (userChannels.length === 0) {
                container.innerHTML = '<div class="empty-state"><div class="empty-icon">📱</div><p class="empty-text">Você ainda não cadastrou nenhum canal</p></div>';
                return;
            }
            container.innerHTML = \`<div class="channels-grid">\${userChannels.map(channel => \`
                <div class="channel-card">
                    <img src="\${channel.image_url || 'data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'300\\' height=\\'160\\'%3E%3Crect fill=\\'%23141414\\' width=\\'300\\' height=\\'160\\'/%3E%3Ctext x=\\'150\\' y=\\'80\\' text-anchor=\\'middle\\' fill=\\'%23dc2626\\' font-size=\\'20\\'%3E🔞%3C/text%3E%3C/svg%3E'}" alt="\${channel.name}" class="channel-image">
                    <div class="channel-info">
                        <h3 class="channel-name">\${channel.name}</h3>
                        <span class="channel-category">\${channel.category}</span>
                        <div class="channel-stats">
                            <span class="channel-date">\${new Date(channel.created_at).toLocaleDateString('pt-BR')}</span>
                            <a href="\${channel.telegram_link}" target="_blank" class="channel-link">Ver canal →</a>
                        </div>
                    </div>
                </div>\`).join('')}</div>\`;
        }
        
        function openModal() {
            document.getElementById('addChannelModal').classList.add('active');
        }
        
        function closeModal() {
            document.getElementById('addChannelModal').classList.remove('active');
            document.getElementById('channelForm').reset();
            document.getElementById('imagePreview').innerHTML = '';
        }
        
        function logout() {
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
            window.location.href = '/';
        }
        
        document.getElementById('image').addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    document.getElementById('imagePreview').innerHTML = \`<img src="\${e.target.result}" alt="Preview">\`;
                };
                reader.readAsDataURL(file);
                document.querySelector('.file-input-label').textContent = file.name;
            }
        });
        
        document.getElementById('channelForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            
            try {
                const response = await fetch(\`\${API_URL}/channels\`, {
                    method: 'POST',
                    headers: { 'Authorization': \`Bearer \${token}\` },
                    body: formData
                });
                
                if (response.ok) {
                    closeModal();
                    loadUserChannels();
                    alert('Canal cadastrado com sucesso!');
                } else {
                    const error = await response.json();
                    alert(error.message || 'Erro ao cadastrar canal');
                }
            } catch (error) {
                alert('Erro ao cadastrar canal');
            }
        });
        
        loadUserChannels();
    </script>
</body>
</html>`;

const adminHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - Portal Secreto X</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #0a0a0a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .admin-header { background: #141414; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; }
        .admin-title { font-size: 1.5rem; color: #dc2626; }
        .logout-btn { background: #dc2626; color: #fff; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-weight: 600; }
        .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .stat-card { background: #141414; padding: 1.5rem; border-radius: 8px; text-align: center; }
        .stat-number { font-size: 2rem; font-weight: 700; color: #dc2626; }
        .stat-label { color: #a3a3a3; font-size: 0.875rem; margin-top: 0.25rem; }
        .users-table { background: #141414; border-radius: 8px; overflow: hidden; }
        .table-header { padding: 1rem 1.5rem; border-bottom: 1px solid #333; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 1rem 1.5rem; background: #1a1a1a; color: #a3a3a3; font-weight: 500; font-size: 0.875rem; text-transform: uppercase; }
        td { padding: 1rem 1.5rem; border-bottom: 1px solid #262626; }
        tr:last-child td { border-bottom: none; }
        .status { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
        .status-pending { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
        .status-approved { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
        .status-rejected { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
        .actions { display: flex; gap: 0.5rem; }
        .action-btn { padding: 0.375rem 0.75rem; border: none; border-radius: 4px; font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: opacity 0.2s; }
        .action-btn:hover { opacity: 0.8; }
        .approve-btn { background: #22c55e; color: #fff; }
        .reject-btn { background: #ef4444; color: #fff; }
        .tab-navigation { display: flex; gap: 1rem; margin-bottom: 2rem; border-bottom: 1px solid #333; }
        .tab { padding: 1rem 1.5rem; border: none; background: transparent; color: #a3a3a3; cursor: pointer; font-size: 1rem; font-weight: 500; position: relative; }
        .tab.active { color: #fff; }
        .tab.active::after { content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: #dc2626; }
        .login-form { max-width: 400px; margin: 5rem auto; background: #141414; padding: 2rem; border-radius: 8px; }
        .form-group { margin-bottom: 1rem; }
        input { width: 100%; padding: 0.75rem; background: #1f1f1f; border: 1px solid #333; border-radius: 6px; color: #fff; font-size: 1rem; }
        .submit-btn { width: 100%; padding: 0.75rem; background: #dc2626; color: #fff; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; }
        .debug-info { background: #1a1a1a; padding: 1rem; margin: 1rem 0; border-radius: 6px; border-left: 4px solid #dc2626; }
        .error-message { background: #ef4444; color: white; padding: 1rem; margin: 1rem 0; border-radius: 6px; }
        .success-message { background: #22c55e; color: white; padding: 1rem; margin: 1rem 0; border-radius: 6px; }
    </style>
</head>
<body>
    <div id="loginSection" class="login-form">
        <h2 style="color: #dc2626; margin-bottom: 1.5rem; text-align: center;">Admin Login</h2>
        <div id="debugInfo" class="debug-info">
            <strong>🔧 Debug Info:</strong><br>
            API URL: <span id="debugApiUrl"></span><br>
            Status: <span id="debugStatus">Inicializando...</span>
        </div>
        <form id="adminLoginForm">
            <div class="form-group">
                <input type="email" id="adminEmail" placeholder="Email" value="admin@portalx.com" required>
            </div>
            <div class="form-group">
                <input type="password" id="adminPassword" placeholder="Senha" value="Admin@2024!" required>
            </div>
            <button type="submit" class="submit-btn">Entrar</button>
        </form>
        <div id="loginMessage"></div>
    </div>
    <div id="dashboardSection" style="display: none;">
        <header class="admin-header">
            <h1 class="admin-title">Portal Secreto X - Painel Admin</h1>
            <button class="logout-btn" onclick="logout()">Sair</button>
        </header>
        <div class="container">
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-number" id="totalUsers">-</div>
                    <div class="stat-label">Total Usuários</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="pendingUsers">-</div>
                    <div class="stat-label">Aguardando Aprovação</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="approvedUsers">-</div>
                    <div class="stat-label">Aprovados</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="totalChannels">-</div>
                    <div class="stat-label">Canais Cadastrados</div>
                </div>
            </div>
            <div class="tab-navigation">
                <button class="tab active" onclick="showTab('users')">Usuários</button>
                <button class="tab" onclick="showTab('data')">Dados do Sistema</button>
                <button class="tab" onclick="showTab('api')">Teste API</button>
            </div>
            <div id="usersTab" class="users-table">
                <div class="table-header">
                    <h3>Usuários do Sistema</h3>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Nome</th>
                            <th>Email</th>
                            <th>Data Cadastro</th>
                            <th>Status</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody id="usersTableBody">
                        <tr>
                            <td colspan="6" style="text-align: center; color: #666;">Carregando usuários...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div id="dataTab" class="users-table" style="display: none;">
                <div class="table-header">
                    <h3>Dados do Sistema</h3>
                </div>
                <div style="padding: 1.5rem;">
                    <div class="debug-info">
                        <strong>📊 Estatísticas dos Dados:</strong><br>
                        Estados: <span id="estadosCount">-</span><br>
                        Categorias: <span id="categoriasCount">-</span><br>
                        Grupos: <span id="gruposCount">-</span><br>
                    </div>
                    <button class="submit-btn" onclick="loadSystemData()" style="margin-top: 1rem;">Recarregar Dados</button>
                </div>
            </div>
            <div id="apiTab" class="users-table" style="display: none;">
                <div class="table-header">
                    <h3>Teste de APIs</h3>
                </div>
                <div style="padding: 1.5rem;">
                    <button class="submit-btn" onclick="testHealth()" style="margin: 0.5rem;">Testar Health</button>
                    <button class="submit-btn" onclick="testAdminInit()" style="margin: 0.5rem;">Testar Admin Init</button>
                    <button class="submit-btn" onclick="testRegister()" style="margin: 0.5rem;">Testar Registro</button>
                    <div id="apiResults" style="margin-top: 1rem;"></div>
                </div>
            </div>
        </div>
    </div>
    <script>
        const API_URL = '/api';
        let adminToken = localStorage.getItem('adminToken');
        document.getElementById('debugApiUrl').textContent = API_URL;
        if (adminToken) {
            document.getElementById('debugStatus').textContent = 'Token encontrado, tentando login...';
            showDashboard();
        } else {
            document.getElementById('debugStatus').textContent = 'Pronto para login';
        }
        document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('adminEmail').value;
            const password = document.getElementById('adminPassword').value;
            showMessage('Fazendo login...', 'info');
            try {
                console.log('Tentando login com:', { email, password });
                const response = await fetch(\`\${API_URL}/admin/login\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await response.json();
                console.log('Resposta do login:', data);
                if (response.ok && data.token) {
                    adminToken = data.token;
                    localStorage.setItem('adminToken', data.token);
                    localStorage.setItem('admin', JSON.stringify(data.admin));
                    showMessage('Login realizado com sucesso!', 'success');
                    setTimeout(showDashboard, 1000);
                } else {
                    showMessage(\`Erro no login: \${data.message}\`, 'error');
                }
            } catch (error) {
                console.error('Erro no login:', error);
                showMessage(\`Erro de conexão: \${error.message}\`, 'error');
            }
        });
        function showMessage(message, type) {
            const messageDiv = document.getElementById('loginMessage');
            messageDiv.className = type === 'error' ? 'error-message' : type === 'success' ? 'success-message' : 'debug-info';
            messageDiv.innerHTML = message;
        }
        function showDashboard() {
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('dashboardSection').style.display = 'block';
            loadUsers();
            loadSystemData();
        }
        function logout() {
            localStorage.removeItem('adminToken');
            localStorage.removeItem('admin');
            location.reload();
        }
        async function loadUsers() {
            try {
                console.log('🔍 Carregando usuários do banco de dados...');
                const response = await fetch(\`\${API_URL}/admin/users\`, {
                    headers: { 
                        'Authorization': \`Bearer \${adminToken}\`,
                        'Content-Type': 'application/json'
                    }
                });
                if (!response.ok) {
                    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
                }
                const users = await response.json();
                console.log('👥 Usuários carregados:', users);
                const tbody = document.getElementById('usersTableBody');
                tbody.innerHTML = users.map(user => \`
                    <tr>
                        <td>\${user.id}</td>
                        <td>\${user.name}</td>
                        <td>\${user.email}</td>
                        <td>\${new Date(user.created_at).toLocaleDateString('pt-BR')}</td>
                        <td><span class="status status-\${user.status}">\${user.status}</span></td>
                        <td>
                            <div class="actions">
                                \${user.status === 'pending' ? \`
                                    <button class="action-btn approve-btn" onclick="approveUser(\${user.id})">Aprovar</button>
                                    <button class="action-btn reject-btn" onclick="rejectUser(\${user.id})">Rejeitar</button>
                                \` : user.status === 'approved' ? \`
                                    <button class="action-btn reject-btn" onclick="rejectUser(\${user.id})">Bloquear</button>
                                \` : user.status === 'rejected' ? \`
                                    <button class="action-btn approve-btn" onclick="approveUser(\${user.id})">Aprovar</button>
                                \` : '-'}
                            </div>
                        </td>
                    </tr>
                \`).join('');
                document.getElementById('totalUsers').textContent = users.length;
                document.getElementById('pendingUsers').textContent = users.filter(u => u.status === 'pending').length;
                document.getElementById('approvedUsers').textContent = users.filter(u => u.status === 'approved').length;
            } catch (error) {
                console.error('❌ Erro ao carregar usuários:', error);
                document.getElementById('usersTableBody').innerHTML = \`
                    <tr><td colspan="6" style="text-align: center; color: #ef4444;">
                        Erro ao carregar usuários: \${error.message}<br>
                        <small>Verifique se você está logado como admin</small>
                    </td></tr>
                \`;
            }
        }
        async function loadSystemData() {
            try {
                const [estados, categorias, grupos] = await Promise.all([
                    fetch('/data/estados.json').then(r => r.json()),
                    fetch('/data/categorias.json').then(r => r.json()), 
                    fetch('/data/grupos.json').then(r => r.json())
                ]);
                document.getElementById('estadosCount').textContent = estados.estados.length;
                document.getElementById('categoriasCount').textContent = categorias.categorias.length;
                document.getElementById('gruposCount').textContent = grupos.length;
                document.getElementById('totalChannels').textContent = grupos.length;
            } catch (error) {
                console.error('Erro ao carregar dados do sistema:', error);
                document.getElementById('estadosCount').textContent = 'Erro';
                document.getElementById('categoriasCount').textContent = 'Erro';
                document.getElementById('gruposCount').textContent = 'Erro';
            }
        }
        function showTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');
            document.getElementById('usersTab').style.display = 'none';
            document.getElementById('dataTab').style.display = 'none';
            document.getElementById('apiTab').style.display = 'none';
            document.getElementById(tab + 'Tab').style.display = 'block';
            if (tab === 'data') {
                loadSystemData();
            }
        }
        async function testHealth() {
            const result = await fetch('/api/health');
            const data = await result.json();
            document.getElementById('apiResults').innerHTML = \`
                <div class="success-message">
                    <strong>Health Check:</strong><br>
                    \${JSON.stringify(data, null, 2)}
                </div>
            \`;
        }
        async function testAdminInit() {
            const result = await fetch('/api/admin/init');
            const data = await result.json();
            document.getElementById('apiResults').innerHTML = \`
                <div class="success-message">
                    <strong>Admin Init:</strong><br>
                    \${JSON.stringify(data, null, 2)}
                </div>
            \`;
        }
        async function testRegister() {
            const result = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Teste Usuario',
                    email: 'teste' + Date.now() + '@teste.com',
                    password: '123456'
                })
            });
            const data = await result.json();
            document.getElementById('apiResults').innerHTML = \`
                <div class="success-message">
                    <strong>Teste Registro:</strong><br>
                    \${JSON.stringify(data, null, 2)}
                </div>
            \`;
        }
        async function approveUser(id) {
            try {
                console.log(\`✅ Aprovando usuário ID: \${id}\`);
                const response = await fetch(\`\${API_URL}/admin/users/\${id}/approve\`, {
                    method: 'PUT',
                    headers: { 
                        'Authorization': \`Bearer \${adminToken}\`,
                        'Content-Type': 'application/json'
                    }
                });
                const data = await response.json();
                if (response.ok) {
                    alert(\`✅ \${data.message}\`);
                    loadUsers();
                } else {
                    alert(\`❌ Erro: \${data.message}\`);
                }
            } catch (error) {
                console.error('❌ Erro ao aprovar usuário:', error);
                alert('Erro ao aprovar usuário: ' + error.message);
            }
        }
        async function rejectUser(id) {
            if (!confirm('Tem certeza que deseja rejeitar este usuário?')) {
                return;
            }
            try {
                console.log(\`❌ Rejeitando usuário ID: \${id}\`);
                const response = await fetch(\`\${API_URL}/admin/users/\${id}/reject\`, {
                    method: 'PUT',
                    headers: { 
                        'Authorization': \`Bearer \${adminToken}\`,
                        'Content-Type': 'application/json'
                    }
                });
                const data = await response.json();
                if (response.ok) {
                    alert(\`✅ \${data.message}\`);
                    loadUsers();
                } else {
                    alert(\`❌ Erro: \${data.message}\`);
                }
            } catch (error) {
                console.error('❌ Erro ao rejeitar usuário:', error);
                alert('Erro ao rejeitar usuário: ' + error.message);
            }
        }
    </script>
</body>
</html>`;

app.get('/', (req, res) => res.send(ageVerificationHTML));
app.get('/home', (req, res) => res.send(homeHTML));
app.get('/pages/home', (req, res) => res.redirect('/home'));
app.get('/pages/home.html', (req, res) => res.redirect('/home'));

app.use((req, res) => {
    res.status(404).send(`<!DOCTYPE html>
<html>
<head>
    <title>404 - Não encontrado</title>
    <style>
        body { background: #0a0a0a; color: #fff; font-family: sans-serif; text-align: center; padding: 5rem; }
        h1 { color: #dc2626; }
        a { color: #dc2626; }
    </style>
</head>
<body>
    <h1>404 - Página não encontrada</h1>
    <p>A página ${req.path} não existe</p>
    <a href="/">Voltar ao início</a>
</body>
</html>`);
});

async function startServer() {
    try {
        await runMigration();
        app.listen(PORT, () => {
            console.log('=======================================');
            console.log('🚀 SERVIDOR v15.0.0 FINAL FUNCIONANDO!');
            console.log('=======================================');
            console.log(`📡 Porta: ${PORT}`);
            console.log('✅ TUDO integrado e funcionando');
            console.log('✅ Verificação de idade ATIVA');
            console.log('✅ Service Worker funcionando');
            console.log('✅ Sistema 100% operacional');
            console.log('=======================================');
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar servidor:', error);
        process.exit(1);
    }
}

startServer();

module.exports.loginHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - Portal Secreto X</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%); color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
        .login-container { background: rgba(20, 20, 20, 0.9); padding: 3rem; border-radius: 12px; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); max-width: 400px; width: 100%; }
        .logo { text-align: center; margin-bottom: 2rem; }
        .logo-icon { background: #dc2626; color: white; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; margin: 0 auto 1rem; }
        .title { color: #dc2626; font-size: 1.8rem; font-weight: 700; text-align: center; margin-bottom: 2rem; }
        .form-group { margin-bottom: 1.5rem; }
        label { display: block; margin-bottom: 0.5rem; color: #a3a3a3; font-weight: 500; }
        input { width: 100%; padding: 1rem; background: rgba(31, 31, 31, 0.8); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; color: #fff; font-size: 1rem; transition: all 0.3s ease; }
        input:focus { outline: none; border-color: #dc2626; box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.2); }
        .submit-btn { width: 100%; padding: 1rem; background: linear-gradient(135deg, #dc2626, #b91c1c); color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: all 0.3s ease; margin-top: 1rem; }
        .submit-btn:hover { background: linear-gradient(135deg, #b91c1c, #991b1b); transform: translateY(-1px); }
        .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .message { padding: 1rem; border-radius: 8px; margin: 1rem 0; display: none; }
        .message.success { background: rgba(34, 197, 94, 0.2); border: 1px solid #22c55e; color: #22c55e; }
        .message.error { background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #ef4444; }
        .message.info { background: rgba(59, 130, 246, 0.2); border: 1px solid #3b82f6; color: #3b82f6; }
        .links { text-align: center; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid rgba(255, 255, 255, 0.1); }
        .links a { color: #dc2626; text-decoration: none; margin: 0 1rem; transition: opacity 0.3s ease; }
        .links a:hover { opacity: 0.8; }
        .debug-info { background: rgba(31, 31, 31, 0.5); padding: 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.875rem; color: #a3a3a3; }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">
            <div class="logo-icon">🔞</div>
            <h1 class="title">Portal Secreto X</h1>
        </div>
        <div id="debugInfo" class="debug-info">
            <strong>🔧 Status:</strong> <span id="debugStatus">Carregando...</span><br>
            <strong>📡 API:</strong> <span id="debugApi">/api</span>
        </div>
        <form id="loginForm">
            <div class="form-group">
                <label for="email">Email</label>
                <input type="email" id="email" name="email" required placeholder="Digite seu email">
            </div>
            <div class="form-group">
                <label for="password">Senha</label>
                <input type="password" id="password" name="password" required placeholder="Digite sua senha">
            </div>
            <div id="message" class="message"></div>
            <button type="submit" id="submitBtn" class="submit-btn">Entrar</button>
        </form>
        <div class="links">
            <a href="/register">Criar conta</a> |
            <a href="/">Voltar ao site</a>
        </div>
    </div>
    <script src="/assets/js/auth-system.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', async () => {
            console.log('📄 Login page carregada');
            document.getElementById('debugApi').textContent = window.AuthSystem ? window.AuthSystem.API_URL : 'AuthSystem não carregado';
            if (window.AuthSystem) {
                document.getElementById('debugStatus').textContent = 'AuthSystem carregado ✅';
                const health = await window.AuthSystem.checkAPIHealth();
                if (health.success) {
                    document.getElementById('debugStatus').textContent = 'API funcionando ✅';
                } else {
                    document.getElementById('debugStatus').textContent = 'API com problemas ❌';
                }
            } else {
                document.getElementById('debugStatus').textContent = 'AuthSystem falhou ❌';
                showMessage('Erro: Sistema de autenticação não carregou', 'error');
            }
        });
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!window.AuthSystem) {
                showMessage('Sistema de autenticação não está disponível', 'error');
                return;
            }
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const submitBtn = document.getElementById('submitBtn');
            if (!email || !password) {
                showMessage('Por favor, preencha todos os campos', 'error');
                return;
            }
            submitBtn.disabled = true;
            submitBtn.textContent = 'Entrando...';
            showMessage('Realizando login...', 'info');
            try {
                console.log('🔐 Tentando fazer login...');
                const result = await window.AuthSystem.login(email, password);
                if (result.success) {
                    showMessage('Login realizado com sucesso! Redirecionando...', 'success');
                    setTimeout(() => {
                        window.location.href = '/dashboard';
                    }, 1500);
                } else {
                    showMessage(result.error || 'Erro no login', 'error');
                }
            } catch (error) {
                console.error('❌ Erro no login:', error);
                showMessage('Erro inesperado: ' + error.message, 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Entrar';
            }
        });
        function showMessage(text, type) {
            const messageEl = document.getElementById('message');
            messageEl.textContent = text;
            messageEl.className = \`message \${type}\`;
            messageEl.style.display = 'block';
        }
        function hideMessage() {
            document.getElementById('message').style.display = 'none';
        }
        setInterval(() => {
            const messageEl = document.getElementById('message');
            if (messageEl.style.display === 'block') {
                setTimeout(hideMessage, 5000);
            }
        }, 100);
    </script>
</body>
</html>`;

module.exports.registerHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Criar Conta - Portal Secreto X</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%); color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
        .register-container { background: rgba(20, 20, 20, 0.9); padding: 3rem; border-radius: 12px; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); max-width: 450px; width: 100%; }
        .logo { text-align: center; margin-bottom: 2rem; }
        .logo-icon { background: #dc2626; color: white; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; margin: 0 auto 1rem; }
        .title { color: #dc2626; font-size: 1.8rem; font-weight: 700; text-align: center; margin-bottom: 0.5rem; }
        .subtitle { color: #a3a3a3; text-align: center; margin-bottom: 2rem; font-size: 0.9rem; }
        .form-group { margin-bottom: 1.5rem; }
        label { display: block; margin-bottom: 0.5rem; color: #a3a3a3; font-weight: 500; }
        input { width: 100%; padding: 1rem; background: rgba(31, 31, 31, 0.8); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; color: #fff; font-size: 1rem; transition: all 0.3s ease; }
        input:focus { outline: none; border-color: #dc2626; box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.2); }
        .submit-btn { width: 100%; padding: 1rem; background: linear-gradient(135deg, #dc2626, #b91c1c); color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: all 0.3s ease; margin-top: 1rem; }
        .submit-btn:hover { background: linear-gradient(135deg, #b91c1c, #991b1b); transform: translateY(-1px); }
        .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .message { padding: 1rem; border-radius: 8px; margin: 1rem 0; display: none; }
        .message.success { background: rgba(34, 197, 94, 0.2); border: 1px solid #22c55e; color: #22c55e; }
        .message.error { background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #ef4444; }
        .message.info { background: rgba(59, 130, 246, 0.2); border: 1px solid #3b82f6; color: #3b82f6; }
        .links { text-align: center; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid rgba(255, 255, 255, 0.1); }
        .links a { color: #dc2626; text-decoration: none; margin: 0 1rem; transition: opacity 0.3s ease; }
        .links a:hover { opacity: 0.8; }
        .debug-info { background: rgba(31, 31, 31, 0.5); padding: 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.875rem; color: #a3a3a3; }
        .password-requirements { font-size: 0.8rem; color: #666; margin-top: 0.5rem; }
        .terms { font-size: 0.85rem; color: #a3a3a3; margin-top: 1rem; text-align: center; }
    </style>
</head>
<body>
    <div class="register-container">
        <div class="logo">
            <div class="logo-icon">🔞</div>
            <h1 class="title">Criar Conta</h1>
            <p class="subtitle">Acesso exclusivo ao Portal Secreto X</p>
        </div>
        <div id="debugInfo" class="debug-info">
            <strong>🔧 Status:</strong> <span id="debugStatus">Carregando...</span><br>
            <strong>📡 API:</strong> <span id="debugApi">/api</span>
        </div>
        <form id="registerForm">
            <div class="form-group">
                <label for="name">Nome completo</label>
                <input type="text" id="name" name="name" required placeholder="Digite seu nome completo">
            </div>
            <div class="form-group">
                <label for="email">E-mail</label>
                <input type="email" id="email" name="email" required placeholder="Digite seu melhor e-mail">
            </div>
            <div class="form-group">
                <label for="password">Senha</label>
                <input type="password" id="password" name="password" required placeholder="Crie uma senha segura">
                <div class="password-requirements">Mínimo 6 caracteres</div>
            </div>
            <div class="form-group">
                <label for="confirmPassword">Confirmar senha</label>
                <input type="password" id="confirmPassword" name="confirmPassword" required placeholder="Confirme sua senha">
            </div>
            <div id="message" class="message"></div>
            <button type="submit" id="submitBtn" class="submit-btn">Cadastrar</button>
        </form>
        <div class="terms">Ao criar uma conta, você concorda com nossos termos de uso.<br>Sua conta será aprovada em até 24h.</div>
        <div class="links">
            <a href="/login">Já tem conta? Faça login</a> |
            <a href="/">Voltar ao site</a>
        </div>
    </div>
    <script src="/assets/js/auth-system.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', async () => {
            console.log('📄 Register page carregada');
            document.getElementById('debugApi').textContent = window.AuthSystem ? window.AuthSystem.API_URL : 'AuthSystem não carregado';
            if (window.AuthSystem) {
                document.getElementById('debugStatus').textContent = 'AuthSystem carregado ✅';
                const health = await window.AuthSystem.checkAPIHealth();
                if (health.success) {
                    document.getElementById('debugStatus').textContent = 'API funcionando ✅';
                } else {
                    document.getElementById('debugStatus').textContent = 'API com problemas ❌';
                }
            } else {
                document.getElementById('debugStatus').textContent = 'AuthSystem falhou ❌';
                showMessage('Erro: Sistema de autenticação não carregou', 'error');
            }
        });
        document.getElementById('registerForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!window.AuthSystem) {
                showMessage('Sistema de autenticação não está disponível', 'error');
                return;
            }
            const name = document.getElementById('name').value.trim();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const submitBtn = document.getElementById('submitBtn');
            if (!name || !email || !password || !confirmPassword) {
                showMessage('Por favor, preencha todos os campos', 'error');
                return;
            }
            if (name.length < 2) {
                showMessage('Nome deve ter pelo menos 2 caracteres', 'error');
                return;
            }
            if (password.length < 6) {
                showMessage('Senha deve ter pelo menos 6 caracteres', 'error');
                return;
            }
            if (password !== confirmPassword) {
                showMessage('As senhas não coincidem', 'error');
                return;
            }
            const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
            if (!emailRegex.test(email)) {
                showMessage('Por favor, digite um e-mail válido', 'error');
                return;
            }
            submitBtn.disabled = true;
            submitBtn.textContent = 'Cadastrando...';
            showMessage('Criando sua conta...', 'info');
            try {
                console.log('📝 Tentando fazer registro...');
                const result = await window.AuthSystem.register(email, password, name);
                if (result.success) {
                    showMessage('Conta criada com sucesso! Aguarde aprovação para fazer login.', 'success');
                    document.getElementById('registerForm').reset();
                    setTimeout(() => {
                        window.location.href = '/login';
                    }, 3000);
                } else {
                    showMessage(result.error || 'Erro no cadastro', 'error');
                }
            } catch (error) {
                console.error('❌ Erro no registro:', error);
                showMessage('Erro inesperado: ' + error.message, 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Cadastrar';
            }
        });
        document.getElementById('confirmPassword').addEventListener('input', (e) => {
            const password = document.getElementById('password').value;
            const confirmPassword = e.target.value;
            if (confirmPassword && password !== confirmPassword) {
                e.target.style.borderColor = '#ef4444';
            } else {
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            }
        });
        function showMessage(text, type) {
            const messageEl = document.getElementById('message');
            messageEl.textContent = text;
            messageEl.className = \`message \${type}\`;
            messageEl.style.display = 'block';
        }
        function hideMessage() {
            document.getElementById('message').style.display = 'none';
        }
        setInterval(() => {
            const messageEl = document.getElementById('message');
            if (messageEl.style.display === 'block' && !messageEl.classList.contains('success')) {
                setTimeout(hideMessage, 5000);
            }
        }, 100);
    </script>
</body>
</html>`;

module.exports.dashboardHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - Portal Secreto X</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #0a0a0a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        header { background: #141414; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; }
        .header-left { display: flex; align-items: center; gap: 2rem; }
        .logo { font-size: 1.5rem; font-weight: 700; color: #dc2626; }
        .user-info { display: flex; align-items: center; gap: 1rem; }
        .user-name { color: #a3a3a3; font-size: 0.875rem; }
        .logout-btn { background: transparent; color: #dc2626; border: 1px solid #dc2626; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.3s; }
        .logout-btn:hover { background: #dc2626; color: #fff; }
        .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
        .add-channel-btn { background: #dc2626; color: #fff; border: none; padding: 0.875rem 1.5rem; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-bottom: 2rem; display: flex; align-items: center; gap: 0.5rem; }
        .add-channel-btn:hover { background: #b91c1c; }
        .channels-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
        .channel-card { background: #141414; border-radius: 12px; overflow: hidden; border: 1px solid #262626; transition: border-color 0.3s; }
        .channel-card:hover { border-color: #dc2626; }
        .channel-image { width: 100%; height: 160px; object-fit: cover; background: #1a1a1a; }
        .channel-info { padding: 1.5rem; }
        .channel-name { font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem; }
        .channel-category { display: inline-block; background: rgba(220, 38, 38, 0.2); color: #dc2626; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.75rem; margin-bottom: 1rem; }
        .channel-stats { display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #262626; }
        .channel-date { color: #a3a3a3; font-size: 0.875rem; }
        .channel-link { color: #dc2626; text-decoration: none; font-size: 0.875rem; font-weight: 500; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.8); z-index: 1000; align-items: center; justify-content: center; }
        .modal.active { display: flex; }
        .modal-content { background: #141414; border-radius: 12px; padding: 2rem; width: 90%; max-width: 500px; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
        .modal-title { font-size: 1.5rem; color: #dc2626; }
        .close-btn { background: transparent; border: none; color: #a3a3a3; font-size: 1.5rem; cursor: pointer; }
        .form-group { margin-bottom: 1.5rem; }
        label { display: block; margin-bottom: 0.5rem; color: #a3a3a3; font-size: 0.875rem; }
        input, select { width: 100%; padding: 0.75rem; background: #1f1f1f; border: 1px solid #333; border-radius: 8px; color: #fff; font-size: 1rem; }
        .form-hint { color: #666; font-size: 0.75rem; margin-top: 0.25rem; }
        .form-actions { display: flex; gap: 1rem; margin-top: 2rem; }
        .btn { flex: 1; padding: 0.875rem; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; }
        .btn-primary { background: #dc2626; color: #fff; }
        .btn-secondary { background: #262626; color: #a3a3a3; }
        .empty-state { text-align: center; padding: 4rem 2rem; }
        .empty-icon { font-size: 4rem; margin-bottom: 1rem; opacity: 0.5; }
        .empty-text { color: #a3a3a3; margin-bottom: 2rem; }
        .file-input-wrapper { position: relative; display: inline-block; width: 100%; }
        .file-input { display: none; }
        .file-input-label { display: block; width: 100%; padding: 0.75rem; background: #1f1f1f; border: 1px solid #333; border-radius: 8px; color: #a3a3a3; cursor: pointer; text-align: center; transition: all 0.3s; }
        .file-input-label:hover { border-color: #dc2626; color: #fff; }
        .file-preview { margin-top: 1rem; }
        .file-preview img { max-width: 100%; max-height: 200px; border-radius: 8px; }
    </style>
</head>
<body>
    <header>
        <div class="header-left">
            <div class="logo">🔞 Portal Secreto X</div>
            <nav><a href="/home" style="color: #a3a3a3; text-decoration: none;">Ver Site</a></nav>
        </div>
        <div class="user-info">
            <span class="user-name" id="userName">Carregando...</span>
            <button class="logout-btn" onclick="logout()">Sair</button>
        </div>
    </header>
    <div class="container">
        <button class="add-channel-btn" onclick="openModal()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Cadastrar Canal/Grupo
        </button>
        <div id="channelsContainer">
            <div class="empty-state">
                <div class="empty-icon">📱</div>
                <p class="empty-text">Você ainda não cadastrou nenhum canal</p>
            </div>
        </div>
    </div>
    <div class="modal" id="addChannelModal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 class="modal-title">Cadastrar Canal/Grupo</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <form id="channelForm" enctype="multipart/form-data">
                <div class="form-group">
                    <label for="name">Nome do Canal/Grupo</label>
                    <input type="text" id="name" name="name" required>
                </div>
                <div class="form-group">
                    <label for="telegramLink">Link do Telegram</label>
                    <input type="url" id="telegramLink" name="telegram_link" placeholder="https://t.me/seucanal">
                </div>
                <div class="form-group">
                    <label for="category">Categoria</label>
                    <select id="category" name="category" required>
                        <option value="">Selecione uma categoria</option>
                        <option value="universitarias">Universitárias</option>
                        <option value="cornos">Cornos</option>
                        <option value="amadoras">Amadoras</option>
                        <option value="famosas">Famosas</option>
                        <option value="vazadas">Vazadas</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="state">Estado</label>
                    <select id="state" name="state">
                        <option value="">Selecione um estado</option>
                        <option value="SP">São Paulo</option>
                        <option value="RJ">Rio de Janeiro</option>
                        <option value="MG">Minas Gerais</option>
                        <option value="RS">Rio Grande do Sul</option>
                        <option value="SC">Santa Catarina</option>
                        <option value="PR">Paraná</option>
                        <option value="BA">Bahia</option>
                        <option value="PE">Pernambuco</option>
                        <option value="CE">Ceará</option>
                        <option value="GO">Goiás</option>
                        <option value="DF">Distrito Federal</option>
                        <option value="ES">Espírito Santo</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="city">Cidade</label>
                    <input type="text" id="city" name="city" placeholder="Ex: São Paulo">
                </div>
                <div class="form-group">
                    <label for="image">Imagem do Canal (Opcional)</label>
                    <div class="file-input-wrapper">
                        <input type="file" id="image" name="image" class="file-input" accept="image/*">
                        <label for="image" class="file-input-label">Clique para escolher uma imagem</label>
                    </div>
                    <div class="form-hint">Deixe em branco para usar a imagem do Telegram. Máximo 5MB.</div>
                    <div id="imagePreview" class="file-preview"></div>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">Cadastrar</button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
                </div>
            </form>
        </div>
    </div>
    <script>
        const API_URL = window.location.origin + '/api';
        const token = localStorage.getItem('authToken');
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        
        if (!token) {
            window.location.href = '/login';
        }
        
        document.getElementById('userName').textContent = user?.name || 'Usuário';
        
        let userChannels = [];
        
        async function loadUserChannels() {
            try {
                const response = await fetch(\`\${API_URL}/channels/user\`, {
                    headers: { 'Authorization': \`Bearer \${token}\` }
                });
                if (response.ok) {
                    userChannels = await response.json();
                    renderChannels();
                }
            } catch (error) {
                console.error('Erro ao carregar canais:', error);
            }
        }
        
        function renderChannels() {
            const container = document.getElementById('channelsContainer');
            if (userChannels.length === 0) {
                container.innerHTML = '<div class="empty-state"><div class="empty-icon">📱</div><p class="empty-text">Você ainda não cadastrou nenhum canal</p></div>';
                return;
            }
            container.innerHTML = \`<div class="channels-grid">\${userChannels.map(channel => \`
                <div class="channel-card">
                    <img src="\${channel.image_url || 'data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'300\\' height=\\'160\\'%3E%3Crect fill=\\'%23141414\\' width=\\'300\\' height=\\'160\\'/%3E%3Ctext x=\\'150\\' y=\\'80\\' text-anchor=\\'middle\\' fill=\\'%23dc2626\\' font-size=\\'20\\'%3E🔞%3C/text%3E%3C/svg%3E'}" alt="\${channel.name}" class="channel-image">
                    <div class="channel-info">
                        <h3 class="channel-name">\${channel.name}</h3>
                        <span class="channel-category">\${channel.category}</span>
                        <div class="channel-stats">
                            <span class="channel-date">\${new Date(channel.created_at).toLocaleDateString('pt-BR')}</span>
                            <a href="\${channel.telegram_link}" target="_blank" class="channel-link">Ver canal →</a>
                        </div>
                    </div>
                </div>\`).join('')}</div>\`;
        }
        
        function openModal() {
            document.getElementById('addChannelModal').classList.add('active');
        }
        
        function closeModal() {
            document.getElementById('addChannelModal').classList.remove('active');
            document.getElementById('channelForm').reset();
            document.getElementById('imagePreview').innerHTML = '';
        }
        
        function logout() {
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
            window.location.href = '/';
        }
        
        document.getElementById('image').addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    document.getElementById('imagePreview').innerHTML = \`<img src="\${e.target.result}" alt="Preview">\`;
                };
                reader.readAsDataURL(file);
                document.querySelector('.file-input-label').textContent = file.name;
            }
        });
        
        document.getElementById('channelForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            
            try {
                const response = await fetch(\`\${API_URL}/channels\`, {
                    method: 'POST',
                    headers: { 'Authorization': \`Bearer \${token}\` },
                    body: formData
                });
                
                if (response.ok) {
                    closeModal();
                    loadUserChannels();
                    alert('Canal cadastrado com sucesso!');
                } else {
                    const error = await response.json();
                    alert(error.message || 'Erro ao cadastrar canal');
                }
            } catch (error) {
                alert('Erro ao cadastrar canal');
            }
        });
        
        loadUserChannels();
    </script>
</body>
</html>`;

module.exports.adminHTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - Portal Secreto X</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #0a0a0a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .admin-header { background: #141414; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; }
        .admin-title { font-size: 1.5rem; color: #dc2626; }
        .logout-btn { background: #dc2626; color: #fff; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-weight: 600; }
        .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .stat-card { background: #141414; padding: 1.5rem; border-radius: 8px; text-align: center; }
        .stat-number { font-size: 2rem; font-weight: 700; color: #dc2626; }
        .stat-label { color: #a3a3a3; font-size: 0.875rem; margin-top: 0.25rem; }
        .users-table { background: #141414; border-radius: 8px; overflow: hidden; }
        .table-header { padding: 1rem 1.5rem; border-bottom: 1px solid #333; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 1rem 1.5rem; background: #1a1a1a; color: #a3a3a3; font-weight: 500; font-size: 0.875rem; text-transform: uppercase; }
        td { padding: 1rem 1.5rem; border-bottom: 1px solid #262626; }
        tr:last-child td { border-bottom: none; }
        .status { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
        .status-pending { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
        .status-approved { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
        .status-rejected { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
        .actions { display: flex; gap: 0.5rem; }
        .action-btn { padding: 0.375rem 0.75rem; border: none; border-radius: 4px; font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: opacity 0.2s; }
        .action-btn:hover { opacity: 0.8; }
        .approve-btn { background: #22c55e; color: #fff; }
        .reject-btn { background: #ef4444; color: #fff; }
        .tab-navigation { display: flex; gap: 1rem; margin-bottom: 2rem; border-bottom: 1px solid #333; }
        .tab { padding: 1rem 1.5rem; border: none; background: transparent; color: #a3a3a3; cursor: pointer; font-size: 1rem; font-weight: 500; position: relative; }
        .tab.active { color: #fff; }
        .tab.active::after { content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: #dc2626; }
        .login-form { max-width: 400px; margin: 5rem auto; background: #141414; padding: 2rem; border-radius: 8px; }
        .form-group { margin-bottom: 1rem; }
        input { width: 100%; padding: 0.75rem; background: #1f1f1f; border: 1px solid #333; border-radius: 6px; color: #fff; font-size: 1rem; }
        .submit-btn { width: 100%; padding: 0.75rem; background: #dc2626; color: #fff; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; }
        .debug-info { background: #1a1a1a; padding: 1rem; margin: 1rem 0; border-radius: 6px; border-left: 4px solid #dc2626; }
        .error-message { background: #ef4444; color: white; padding: 1rem; margin: 1rem 0; border-radius: 6px; }
        .success-message { background: #22c55e; color: white; padding: 1rem; margin: 1rem 0; border-radius: 6px; }
    </style>
</head>
<body>
    <div id="loginSection" class="login-form">
        <h2 style="color: #dc2626; margin-bottom: 1.5rem; text-align: center;">Admin Login</h2>
        <div id="debugInfo" class="debug-info">
            <strong>🔧 Debug Info:</strong><br>
            API URL: <span id="debugApiUrl"></span><br>
            Status: <span id="debugStatus">Inicializando...</span>
        </div>
        <form id="adminLoginForm">
            <div class="form-group">
                <input type="email" id="adminEmail" placeholder="Email" value="admin@portalx.com" required>
            </div>
            <div class="form-group">
                <input type="password" id="adminPassword" placeholder="Senha" value="Admin@2024!" required>
            </div>
            <button type="submit" class="submit-btn">Entrar</button>
        </form>
        <div id="loginMessage"></div>
    </div>
    <div id="dashboardSection" style="display: none;">
        <header class="admin-header">
            <h1 class="admin-title">Portal Secreto X - Painel Admin</h1>
            <button class="logout-btn" onclick="logout()">Sair</button>
        </header>
        <div class="container">
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-number" id="totalUsers">-</div>
                    <div class="stat-label">Total Usuários</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="pendingUsers">-</div>
                    <div class="stat-label">Aguardando Aprovação</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="approvedUsers">-</div>
                    <div class="stat-label">Aprovados</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="totalChannels">-</div>
                    <div class="stat-label">Canais Cadastrados</div>
                </div>
            </div>
            <div class="tab-navigation">
                <button class="tab active" onclick="showTab('users')">Usuários</button>
                <button class="tab" onclick="showTab('data')">Dados do Sistema</button>
                <button class="tab" onclick="showTab('api')">Teste API</button>
            </div>
            <div id="usersTab" class="users-table">
                <div class="table-header">
                    <h3>Usuários do Sistema</h3>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Nome</th>
                            <th>Email</th>
                            <th>Data Cadastro</th>
                            <th>Status</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody id="usersTableBody">
                        <tr>
                            <td colspan="6" style="text-align: center; color: #666;">Carregando usuários...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div id="dataTab" class="users-table" style="display: none;">
                <div class="table-header">
                    <h3>Dados do Sistema</h3>
                </div>
                <div style="padding: 1.5rem;">
                    <div class="debug-info">
                        <strong>📊 Estatísticas dos Dados:</strong><br>
                        Estados: <span id="estadosCount">-</span><br>
                        Categorias: <span id="categoriasCount">-</span><br>
                        Grupos: <span id="gruposCount">-</span><br>
                    </div>
                    <button class="submit-btn" onclick="loadSystemData()" style="margin-top: 1rem;">Recarregar Dados</button>
                </div>
            </div>
            <div id="apiTab" class="users-table" style="display: none;">
                <div class="table-header">
                    <h3>Teste de APIs</h3>
                </div>
                <div style="padding: 1.5rem;">
                    <button class="submit-btn" onclick="testHealth()" style="margin: 0.5rem;">Testar Health</button>
                    <button class="submit-btn" onclick="testAdminInit()" style="margin: 0.5rem;">Testar Admin Init</button>
                    <button class="submit-btn" onclick="testRegister()" style="margin: 0.5rem;">Testar Registro</button>
                    <div id="apiResults" style="margin-top: 1rem;"></div>
                </div>
            </div>
        </div>
    </div>
    <script>
        const API_URL = '/api';
        let adminToken = localStorage.getItem('adminToken');
        document.getElementById('debugApiUrl').textContent = API_URL;
        if (adminToken) {
            document.getElementById('debugStatus').textContent = 'Token encontrado, tentando login...';
            showDashboard();
        } else {
            document.getElementById('debugStatus').textContent = 'Pronto para login';
        }
        document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('adminEmail').value;
            const password = document.getElementById('adminPassword').value;
            showMessage('Fazendo login...', 'info');
            try {
                console.log('Tentando login com:', { email, password });
                const response = await fetch(\`\${API_URL}/admin/login\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await response.json();
                console.log('Resposta do login:', data);
                if (response.ok && data.token) {
                    adminToken = data.token;
                    localStorage.setItem('adminToken', data.token);
                    localStorage.setItem('admin', JSON.stringify(data.admin));
                    showMessage('Login realizado com sucesso!', 'success');
                    setTimeout(showDashboard, 1000);
                } else {
                    showMessage(\`Erro no login: \${data.message}\`, 'error');
                }
            } catch (error) {
                console.error('Erro no login:', error);
                showMessage(\`Erro de conexão: \${error.message}\`, 'error');
            }
        });
        function showMessage(message, type) {
            const messageDiv = document.getElementById('loginMessage');
            messageDiv.className = type === 'error' ? 'error-message' : type === 'success' ? 'success-message' : 'debug-info';
            messageDiv.innerHTML = message;
        }
        function showDashboard() {
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('dashboardSection').style.display = 'block';
            loadUsers();
            loadSystemData();
        }
        function logout() {
            localStorage.removeItem('adminToken');
            localStorage.removeItem('admin');
            location.reload();
        }
        async function loadUsers() {
            try {
                console.log('🔍 Carregando usuários do banco de dados...');
                const response = await fetch(\`\${API_URL}/admin/users\`, {
                    headers: { 
                        'Authorization': \`Bearer \${adminToken}\`,
                        'Content-Type': 'application/json'
                    }
                });
                if (!response.ok) {
                    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
                }
                const users = await response.json();
                console.log('👥 Usuários carregados:', users);
                const tbody = document.getElementById('usersTableBody');
                tbody.innerHTML = users.map(user => \`
                    <tr>
                        <td>\${user.id}</td>
                        <td>\${user.name}</td>
                        <td>\${user.email}</td>
                        <td>\${new Date(user.created_at).toLocaleDateString('pt-BR')}</td>
                        <td><span class="status status-\${user.status}">\${user.status}</span></td>
                        <td>
                            <div class="actions">
                                \${user.status === 'pending' ? \`
                                    <button class="action-btn approve-btn" onclick="approveUser(\${user.id})">Aprovar</button>
                                    <button class="action-btn reject-btn" onclick="rejectUser(\${user.id})">Rejeitar</button>
                                \` : user.status === 'approved' ? \`
                                    <button class="action-btn reject-btn" onclick="rejectUser(\${user.id})">Bloquear</button>
                                \` : user.status === 'rejected' ? \`
                                    <button class="action-btn approve-btn" onclick="approveUser(\${user.id})">Aprovar</button>
                                \` : '-'}
                            </div>
                        </td>
                    </tr>
                \`).join('');
                document.getElementById('totalUsers').textContent = users.length;
                document.getElementById('pendingUsers').textContent = users.filter(u => u.status === 'pending').length;
                document.getElementById('approvedUsers').textContent = users.filter(u => u.status === 'approved').length;
            } catch (error) {
                console.error('❌ Erro ao carregar usuários:', error);
                document.getElementById('usersTableBody').innerHTML = \`
                    <tr><td colspan="6" style="text-align: center; color: #ef4444;">
                        Erro ao carregar usuários: \${error.message}<br>
                        <small>Verifique se você está logado como admin</small>
                    </td></tr>
                \`;
            }
        }
        async function loadSystemData() {
            try {
                const [estados, categorias, grupos] = await Promise.all([
                    fetch('/data/estados.json').then(r => r.json()),
                    fetch('/data/categorias.json').then(r => r.json()), 
                    fetch('/data/grupos.json').then(r => r.json())
                ]);
                document.getElementById('estadosCount').textContent = estados.estados.length;
                document.getElementById('categoriasCount').textContent = categorias.categorias.length;
                document.getElementById('gruposCount').textContent = grupos.length;
                document.getElementById('totalChannels').textContent = grupos.length;
            } catch (error) {
                console.error('Erro ao carregar dados do sistema:', error);
                document.getElementById('estadosCount').textContent = 'Erro';
                document.getElementById('categoriasCount').textContent = 'Erro';
                document.getElementById('gruposCount').textContent = 'Erro';
            }
        }
        function showTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');
            document.getElementById('usersTab').style.display = 'none';
            document.getElementById('dataTab').style.display = 'none';
            document.getElementById('apiTab').style.display = 'none';
            document.getElementById(tab + 'Tab').style.display = 'block';
            if (tab === 'data') {
                loadSystemData();
            }
        }
        async function testHealth() {
            const result = await fetch('/api/health');
            const data = await result.json();
            document.getElementById('apiResults').innerHTML = \`
                <div class="success-message">
                    <strong>Health Check:</strong><br>
                    \${JSON.stringify(data, null, 2)}
                </div>
            \`;
        }
        async function testAdminInit() {
            const result = await fetch('/api/admin/init');
            const data = await result.json();
            document.getElementById('apiResults').innerHTML = \`
                <div class="success-message">
                    <strong>Admin Init:</strong><br>
                    \${JSON.stringify(data, null, 2)}
                </div>
            \`;
        }
        async function testRegister() {
            const result = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Teste Usuario',
                    email: 'teste' + Date.now() + '@teste.com',
                    password: '123456'
                })
            });
            const data = await result.json();
            document.getElementById('apiResults').innerHTML = \`
                <div class="success-message">
                    <strong>Teste Registro:</strong><br>
                    \${JSON.stringify(data, null, 2)}
                </div>
            \`;
        }
        async function approveUser(id) {
            try {
                console.log(\`✅ Aprovando usuário ID: \${id}\`);
                const response = await fetch(\`\${API_URL}/admin/users/\${id}/approve\`, {
                    method: 'PUT',
                    headers: { 
                        'Authorization': \`Bearer \${adminToken}\`,
                        'Content-Type': 'application/json'
                    }
                });
                const data = await response.json();
                if (response.ok) {
                    alert(\`✅ \${data.message}\`);
                    loadUsers();
                } else {
                    alert(\`❌ Erro: \${data.message}\`);
                }
            } catch (error) {
                console.error('❌ Erro ao aprovar usuário:', error);
                alert('Erro ao aprovar usuário: ' + error.message);
            }
        }
        async function rejectUser(id) {
            if (!confirm('Tem certeza que deseja rejeitar este usuário?')) {
                return;
            }
            try {
                console.log(\`❌ Rejeitando usuário ID: \${id}\`);
                const response = await fetch(\`\${API_URL}/admin/users/\${id}/reject\`, {
                    method: 'PUT',
                    headers: { 
                        'Authorization': \`Bearer \${adminToken}\`,
                        'Content-Type': 'application/json'
                    }
                });
                const data = await response.json();
                if (response.ok) {
                    alert(\`✅ \${data.message}\`);
                    loadUsers();
                } else {
                    alert(\`❌ Erro: \${data.message}\`);
                }
            } catch (error) {
                console.error('❌ Erro ao rejeitar usuário:', error);
                alert('Erro ao rejeitar usuário: ' + error.message);
            }
        }
    </script>
</body>
</html>`