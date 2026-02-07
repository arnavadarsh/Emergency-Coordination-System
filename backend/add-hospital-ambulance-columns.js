const { Client } = require('pg');

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.xwvtawlrdgeulqnbviem',
  password: 'ArnavECSBTP_27',
  ssl: { rejectUnauthorized: false }
});

async function addColumns() {
  try {
    await client.connect();
    console.log('Connected to database');

    // Add hospital_id column
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS hospital_id UUID NULL;
    `);
    console.log('✓ Added hospital_id column');

    // Add ambulance_id column
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS ambulance_id UUID NULL;
    `);
    console.log('✓ Added ambulance_id column');

    console.log('\n✅ Columns added successfully');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

addColumns();
