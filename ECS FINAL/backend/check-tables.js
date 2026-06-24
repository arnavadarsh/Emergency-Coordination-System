const { Client } = require('pg');

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.xwvtawlrdgeulqnbviem',
  password: 'ArnavECSBTP_27',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

async function checkTables() {
  try {
    await client.connect();
    console.log('Connected to database\n');
    
    // Check tables
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log('📋 Tables in database:');
    tablesResult.rows.forEach(row => console.log('  -', row.table_name));
    
    // Check users table columns
    console.log('\n📋 Columns in users table:');
    const usersColumns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);
    usersColumns.rows.forEach(row => {
      console.log(`  - ${row.column_name} (${row.data_type}) ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    
    await client.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

checkTables();
