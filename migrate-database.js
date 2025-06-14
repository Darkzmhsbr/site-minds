#!/usr/bin/env node

// 🔧 SCRIPT DE MIGRAÇÃO MANUAL DO BANCO DE DADOS
// Execute este arquivo se ainda houver problemas de estrutura

const { Pool } = require('pg');

console.log('🗄️ INICIANDO MIGRAÇÃO MANUAL DO BANCO DE DADOS');
console.log('==============================================\n');

// Configuração do banco
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Verificando estrutura atual das tabelas...\n');
        
        // ==================== MIGRAÇÃO TABELA USERS ====================
        console.log('👥 Verificando tabela USERS...');
        
        // Verificar se tabela users existe
        const usersTableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'users'
            );
        `);
        
        if (!usersTableCheck.rows[0].exists) {
            console.log('📝 Criando tabela users...');
            await client.query(`
                CREATE TABLE users (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    status VARCHAR(50) DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            console.log('✅ Tabela users criada');
        } else {
            console.log('✅ Tabela users já existe');
            
            // Verificar se coluna status existe
            const statusColumnCheck = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'users' AND column_name = 'status'
                );
            `);
            
            if (!statusColumnCheck.rows[0].exists) {
                console.log('📝 Adicionando coluna status na tabela users...');
                await client.query(`ALTER TABLE users ADD COLUMN status VARCHAR(50) DEFAULT 'pending';`);
                console.log('✅ Coluna status adicionada na tabela users');
            }
        }
        
        // ==================== MIGRAÇÃO TABELA CHANNELS ====================
        console.log('\n📱 Verificando tabela CHANNELS...');
        
        // Verificar se tabela channels existe
        const channelsTableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'channels'
            );
        `);
        
        if (!channelsTableCheck.rows[0].exists) {
            console.log('📝 Criando tabela channels completa...');
            await client.query(`
                CREATE TABLE channels (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    telegram_link VARCHAR(500) NOT NULL,
                    whatsapp_link VARCHAR(500),
                    category VARCHAR(100) NOT NULL,
                    state VARCHAR(50),
                    image_url VARCHAR(500),
                    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    status VARCHAR(50) DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(telegram_link)
                );
            `);
            console.log('✅ Tabela channels criada');
        } else {
            console.log('✅ Tabela channels já existe - verificando colunas...');
            
            // Lista de colunas necessárias
            const requiredColumns = [
                { name: 'description', type: 'TEXT' },
                { name: 'image_url', type: 'VARCHAR(500)' },
                { name: 'owner_id', type: 'INTEGER' },
                { name: 'whatsapp_link', type: 'VARCHAR(500)' }
            ];
            
            for (const column of requiredColumns) {
                const columnCheck = await client.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'channels' AND column_name = $1
                    );
                `, [column.name]);
                
                if (!columnCheck.rows[0].exists) {
                    console.log(`📝 Adicionando coluna ${column.name}...`);
                    try {
                        await client.query(`ALTER TABLE channels ADD COLUMN ${column.name} ${column.type};`);
                        console.log(`✅ Coluna ${column.name} adicionada`);
                    } catch (error) {
                        console.log(`⚠️ Erro ao adicionar coluna ${column.name}:`, error.message);
                    }
                } else {
                    console.log(`✅ Coluna ${column.name} já existe`);
                }
            }
            
            // Verificar e adicionar constraints
            console.log('\n🔧 Verificando constraints...');
            
            // NOT NULL constraints
            try {
                await client.query(`ALTER TABLE channels ALTER COLUMN telegram_link SET NOT NULL;`);
                console.log('✅ Constraint NOT NULL telegram_link aplicada');
            } catch (error) {
                console.log('ℹ️ Constraint NOT NULL telegram_link já existe ou erro:', error.message);
            }
            
            try {
                await client.query(`ALTER TABLE channels ALTER COLUMN category SET NOT NULL;`);
                console.log('✅ Constraint NOT NULL category aplicada');
            } catch (error) {
                console.log('ℹ️ Constraint NOT NULL category já existe ou erro:', error.message);
            }
            
            // Foreign key constraint
            try {
                await client.query(`
                    ALTER TABLE channels 
                    ADD CONSTRAINT channels_owner_id_fkey 
                    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
                `);
                console.log('✅ Foreign key owner_id adicionada');
            } catch (error) {
                if (error.code === '42710') {
                    console.log('ℹ️ Foreign key owner_id já existe');
                } else {
                    console.log('⚠️ Erro ao criar foreign key:', error.message);
                }
            }
            
            // Unique constraint
            try {
                await client.query(`
                    ALTER TABLE channels 
                    ADD CONSTRAINT channels_telegram_link_unique 
                    UNIQUE (telegram_link);
                `);
                console.log('✅ Constraint unique telegram_link adicionada');
            } catch (error) {
                if (error.code === '42710') {
                    console.log('ℹ️ Constraint unique telegram_link já existe');
                } else {
                    console.log('⚠️ Erro ao criar unique constraint:', error.message);
                }
            }
        }
        
        // ==================== VERIFICAR ADMIN ====================
        console.log('\n👤 Verificando usuário admin...');
        
        const adminCheck = await client.query(`
            SELECT * FROM users WHERE email = 'admin@portalx.com';
        `);
        
        if (adminCheck.rows.length === 0) {
            console.log('📝 Criando usuário admin...');
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash('admin123', 12);
            
            await client.query(`
                INSERT INTO users (name, email, password, status)
                VALUES ('Admin', 'admin@portalx.com', $1, 'approved');
            `, [hashedPassword]);
            console.log('✅ Usuário admin criado');
        } else {
            // Atualizar status do admin se necessário
            await client.query(`
                UPDATE users 
                SET status = 'approved' 
                WHERE email = 'admin@portalx.com';
            `);
            console.log('✅ Status do admin atualizado');
        }
        
        // ==================== ESTATÍSTICAS ====================
        console.log('\n📊 ESTATÍSTICAS FINAIS:');
        
        const userCount = await client.query('SELECT COUNT(*) FROM users');
        console.log(`   👥 Usuários: ${userCount.rows[0].count}`);
        
        const channelCount = await client.query('SELECT COUNT(*) FROM channels');
        console.log(`   📱 Canais: ${channelCount.rows[0].count}`);
        
        const pendingUsers = await client.query("SELECT COUNT(*) FROM users WHERE status = 'pending'");
        console.log(`   ⏳ Usuários pendentes: ${pendingUsers.rows[0].count}`);
        
        const pendingChannels = await client.query("SELECT COUNT(*) FROM channels WHERE status = 'pending'");
        console.log(`   ⏳ Canais pendentes: ${pendingChannels.rows[0].count}`);
        
        console.log('\n🎉 MIGRAÇÃO CONCLUÍDA COM SUCESSO!');
        console.log('📊 Estrutura do banco atualizada:');
        console.log('   ✅ Tabela users com coluna status');
        console.log('   ✅ Tabela channels com todas as colunas');
        console.log('   ✅ Constraints e foreign keys configuradas');
        console.log('   ✅ Usuário admin configurado');
        
    } catch (error) {
        console.error('❌ Erro na migração:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Executar migração
runMigration()
    .then(() => {
        console.log('\n🚀 Banco de dados pronto para uso!');
        console.log('👤 Admin: admin@portalx.com / admin123');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Falha na migração:', error);
        process.exit(1);
    });