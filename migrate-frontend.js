#!/usr/bin/env node

// SCRIPT PARA MIGRAR FRONTEND PARA RAILWAY
const fs = require('fs');
const path = require('path');

console.log('🚀 MIGRANDO FRONTEND PARA RAILWAY...\n');

// Função para copiar diretório recursivamente
function copyDirectory(source, destination) {
    if (!fs.existsSync(destination)) {
        fs.mkdirSync(destination, { recursive: true });
    }

    const items = fs.readdirSync(source);
    
    for (const item of items) {
        const sourcePath = path.join(source, item);
        const destPath = path.join(destination, item);
        
        const stat = fs.statSync(sourcePath);
        
        if (stat.isDirectory()) {
            copyDirectory(sourcePath, destPath);
        } else {
            fs.copyFileSync(sourcePath, destPath);
            console.log(`📄 Copiado: ${item}`);
        }
    }
}

// Função para atualizar auth-system.js
function updateAuthSystem() {
    const authSystemPath = 'public/assets/js/auth-system.js';
    
    const newAuthContent = `// AUTH SYSTEM PARA RAILWAY - URLs RELATIVAS
class AuthSystem {
    constructor() {
        this.token = localStorage.getItem('authToken') || localStorage.getItem('adminToken');
        // URL relativa - funciona perfeitamente no Railway
        this.API_URL = '/api';
        
        console.log('🔧 AuthSystem inicializado para Railway');
        console.log('📡 API URL:', this.API_URL);
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

            if (response.ok && data.token) {
                this.token = data.token;
                localStorage.setItem('authToken', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
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

window.authSystem = new AuthSystem();

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Portal Secreto X carregado no Railway!');
});`;

    fs.writeFileSync(authSystemPath, newAuthContent);
    console.log('✅ auth-system.js atualizado para Railway');
}

try {
    // 1. Criar pasta public se não existir
    if (!fs.existsSync('public')) {
        fs.mkdirSync('public');
        console.log('📁 Pasta public criada');
    }

    // 2. Verificar se as pastas do frontend existem
    const frontendPath = '../FRONTEND';
    if (!fs.existsSync(frontendPath)) {
        console.log('❌ Pasta FRONTEND não encontrada!');
        console.log('📋 Execute este script na pasta BACKEND');
        process.exit(1);
    }

    // 3. Copiar assets
    console.log('📂 Copiando assets...');
    if (fs.existsSync(path.join(frontendPath, 'assets'))) {
        copyDirectory(path.join(frontendPath, 'assets'), 'public/assets');
    }

    // 4. Copiar pages
    console.log('\\n📂 Copiando pages...');
    if (fs.existsSync(path.join(frontendPath, 'pages'))) {
        copyDirectory(path.join(frontendPath, 'pages'), 'public/pages');
    }

    // 5. Copiar outros arquivos do frontend
    console.log('\\n📂 Copiando outros arquivos...');
    const filesToCopy = ['404.html', 'index.html'];
    for (const file of filesToCopy) {
        const sourcePath = path.join(frontendPath, file);
        if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, path.join('public', file));
            console.log(`📄 Copiado: ${file}`);
        }
    }

    // 6. Atualizar auth-system.js
    console.log('\\n🔧 Atualizando auth-system.js...');
    updateAuthSystem();

    console.log('\\n🎉 MIGRAÇÃO CONCLUÍDA!');
    console.log('\\n📋 PRÓXIMOS PASSOS:');
    console.log('1. Substitua o server.js pelo novo (com frontend integrado)');
    console.log('2. Execute: railway up');
    console.log('3. Acesse: https://portal-x-api-production.up.railway.app');
    console.log('4. Login admin: admin@portalx.com / admin123');
    console.log('\\n✅ PROBLEMA RESOLVIDO DEFINITIVAMENTE!');

} catch (error) {
    console.error('❌ Erro na migração:', error.message);
    process.exit(1);
}