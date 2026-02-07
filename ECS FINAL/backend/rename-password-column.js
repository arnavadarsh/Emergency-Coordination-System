const { Client } = require('pg');

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.xwvtawlrdgeulqnbviem',
  password: 'ArnavECSBTP_27',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

async function renameColumn() {
  try {
    await client.connect();
    console.log('Connected to database\n');
    
    // Rename column from password_hash to password
    console.log('Renaming password_hash to password...');
    await client.query(`
      ALTER TABLE users 
      RENAME COLUMN password_hash TO password
    `);
    console.log('✅ Column renamed successfully');
    
    await client.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

renameColumn();
