const { Client } = require('pg');

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.xwvtawlrdgeulqnbviem',
  password: 'ArnavECSBTP_27',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

async function addColumns() {
  try {
    await client.connect();
    console.log('Connected to database');
    
    await client.query('ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8)');
    console.log('Added latitude column');
    
    await client.query('ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8)');
    console.log('Added longitude column');
    
    console.log('✅ Migration completed successfully');
    await client.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

addColumns();
