// 🚀 AUTH SYSTEM COMPLETO - PORTAL SECRETO X v4.0.0
console.log('🔧 Carregando AuthSystem v4.0.0...');

class AuthSystem {
    constructor() {
        this.token = localStorage.getItem('authToken') || localStorage.getItem('adminToken');
        // URL relativa - funciona perfeitamente no Railway
        this.API_URL = '/api';
        
        console.log('🔧 AuthSystem inicializado para Railway');
        console.log('📡 API URL:', this.API_URL);
        console.log('🔑 Token presente:', !!this.token);
    }

    // ==================== AUTENTICAÇÃO ====================

    async register(email, password, name) {
        try {
            console.log('📝 Registrando usuário:', email);
            
            const response = await fetch(`${this.API_URL}/auth/register`, {
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
                
                console.log('✅ Registro realizado com sucesso');
                
                return { 
                    success: true, 
                    message: data.message,
                    token: data.token,
                    user: data.user 
                };
            } else {
                return { 
                    success: false, 
                    error: data.message || 'Erro no registro' 
                };
            }
        } catch (error) {
            console.error('❌ Erro no registro:', error);
            return { 
                success: false, 
                error: 'Erro de conexão com o servidor' 
            };
        }
    }

    async login(email, password) {
        try {
            console.log('🔐 Fazendo login:', email);
            
            const response = await fetch(`${this.API_URL}/auth/login`, {
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
                
                console.log('✅ Login realizado com sucesso');
                
                return { 
                    success: true,
                    token: data.token,
                    user: data.user 
                };
            } else {
                return { 
                    success: false, 
                    error: data.message || 'Credenciais inválidas' 
                };
            }
        } catch (error) {
            console.error('❌ Erro no login:', error);
            return { 
                success: false, 
                error: 'Erro de conexão com o servidor' 
            };
        }
    }

    async adminLogin(email, password) {
        try {
            console.log('👑 Login admin:', email);
            
            const response = await fetch(`${this.API_URL}/admin/login`, {
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
                
                console.log('✅ Login admin realizado com sucesso');
                
                return { success: true, data };
            } else {
                return { 
                    success: false, 
                    error: data.message || 'Credenciais inválidas' 
                };
            }
        } catch (error) {
            console.error('❌ Erro no login admin:', error);
            return { 
                success: false, 
                error: 'Erro de conexão com o servidor' 
            };
        }
    }

    logout() {
        console.log('🚪 Fazendo logout...');
        
        this.token = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('adminToken');
        localStorage.removeItem('user');
        localStorage.removeItem('admin');
        
        window.location.href = '/';
    }

    // ==================== GETTERS ====================

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

    // ==================== STATUS DO USUÁRIO ====================

    async getUserStatus() {
        try {
            const response = await fetch(`${this.API_URL}/user/status`, {
                headers: { 
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                return { success: true, status: data.status };
            } else {
                throw new Error('Erro ao verificar status');
            }
        } catch (error) {
            console.error('❌ Erro ao verificar status:', error);
            return { success: false, error: error.message };
        }
    }

    // ==================== GERENCIAMENTO DE CANAIS ====================

    async createChannel(channelData) {
        try {
            console.log('📤 Criando canal:', channelData.name);
            
            const response = await fetch(`${this.API_URL}/channels`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(channelData)
            });

            const data = await response.json();

            if (response.ok) {
                console.log('✅ Canal criado com sucesso');
                return { success: true, data };
            } else {
                return { 
                    success: false, 
                    error: data.message || 'Erro ao criar canal' 
                };
            }
        } catch (error) {
            console.error('❌ Erro ao criar canal:', error);
            return { 
                success: false, 
                error: 'Erro de conexão com o servidor' 
            };
        }
    }

    async getUserChannels() {
        try {
            console.log('📱 Buscando canais do usuário...');
            
            const response = await fetch(`${this.API_URL}/channels/user`, {
                headers: { 
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const channels = await response.json();
                console.log(`✅ ${channels.length} canais encontrados`);
                return { success: true, channels };
            } else {
                throw new Error('Erro ao carregar canais');
            }
        } catch (error) {
            console.error('❌ Erro ao carregar canais:', error);
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    async updateChannel(channelId, channelData) {
        try {
            console.log('✏️ Atualizando canal:', channelId);
            
            const response = await fetch(`${this.API_URL}/channels/${channelId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(channelData)
            });

            const data = await response.json();

            if (response.ok) {
                console.log('✅ Canal atualizado com sucesso');
                return { success: true, data };
            } else {
                return { 
                    success: false, 
                    error: data.message || 'Erro ao atualizar canal' 
                };
            }
        } catch (error) {
            console.error('❌ Erro ao atualizar canal:', error);
            return { 
                success: false, 
                error: 'Erro de conexão com o servidor' 
            };
        }
    }

    async deleteChannel(channelId) {
        try {
            console.log('🗑️ Deletando canal:', channelId);
            
            const response = await fetch(`${this.API_URL}/channels/${channelId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (response.ok) {
                console.log('✅ Canal deletado com sucesso');
                return { success: true, message: data.message };
            } else {
                return { 
                    success: false, 
                    error: data.message || 'Erro ao deletar canal' 
                };
            }
        } catch (error) {
            console.error('❌ Erro ao deletar canal:', error);
            return { 
                success: false, 
                error: 'Erro de conexão com o servidor' 
            };
        }
    }

    // ==================== UTILITÁRIOS ====================

    async testConnection() {
        try {
            const response = await fetch(`${this.API_URL}/health`);
            const data = await response.json();
            
            console.log('🏥 Health Check:', data);
            
            return { 
                success: true, 
                status: data.status,
                version: data.version
            };
        } catch (error) {
            console.error('❌ Erro no health check:', error);
            return { 
                success: false, 
                error: 'API não disponível' 
            };
        }
    }

    // MÉTODO LEGADO (compatibilidade com versões antigas)
    async createChannel(telegramLink, category, customImage) {
        // Se chamado com os parâmetros antigos, converter para o novo formato
        if (typeof telegramLink === 'string' && typeof category === 'string') {
            const channelData = {
                name: `Canal ${category}`,
                telegram_link: telegramLink,
                category: category,
                image_url: customImage || null
            };
            return this.createChannel(channelData);
        }
        
        // Se chamado com objeto (novo formato), processar normalmente
        return this.createChannel(telegramLink);
    }
}

// Instanciar globalmente
window.AuthSystem = new AuthSystem();

// Debug info na inicialização
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Portal Secreto X v4.0.0 carregado no Railway!');
    console.log('🔧 AuthSystem disponível globalmente');
    
    // Testar conexão com a API
    window.AuthSystem.testConnection()
        .then(result => {
            if (result.success) {
                console.log('✅ API Online - Versão:', result.version);
            } else {
                console.log('❌ API Offline:', result.error);
            }
        });
});

// Export para compatibilidade
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuthSystem;
}