const { Client } = require('pg');

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.xwvtawlrdgeulqnbviem',
  password: 'ArnavECSBTP_27',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

async function mergeTables() {
  try {
    await client.connect();
    console.log('Connected to database');
    
    // Step 1: Add profile fields to users table
    console.log('Adding profile fields to users table...');
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS last_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20),
      ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(50),
      ADD COLUMN IF NOT EXISTS date_of_birth DATE,
      ADD COLUMN IF NOT EXISTS address TEXT,
      ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8),
      ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8),
      ADD COLUMN IF NOT EXISTS blood_type VARCHAR(5),
      ADD COLUMN IF NOT EXISTS medical_notes TEXT,
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false
    `);
    console.log('✅ Profile fields added to users table');
    
    // Step 2: Migrate data from user_profiles to users
    console.log('Migrating data from user_profiles to users...');
    await client.query(`
      UPDATE users u
      SET 
        first_name = up.first_name,
        last_name = up.last_name,
        phone_number = up.phone_number,
        emergency_contact = up.emergency_contact,
        date_of_birth = up.date_of_birth,
        address = up.address,
        latitude = up.latitude,
        longitude = up.longitude
      FROM user_profiles up
      WHERE u.id = up.user_id
    `);
    console.log('✅ Data migrated successfully');
    
    // Step 3: Drop foreign key constraint and user_profiles table
    console.log('Dropping user_profiles table...');
    await client.query('DROP TABLE IF EXISTS user_profiles CASCADE');
    console.log('✅ user_profiles table dropped');
    
    console.log('\n🎉 Table merge completed successfully!');
    await client.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err);
    process.exit(1);
  }
}

mergeTables();
