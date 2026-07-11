import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { HospitalsService } from '../src/hospitals/hospitals.service';
import { UsersService } from '../src/users/users.service';
import { UserRole } from '../src/common/enums';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Hospital } from '../src/hospitals/entities/hospital.entity';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const hospitalsService = app.get(HospitalsService);
  const usersService = app.get(UsersService);
  const hospitalRepo = app.get<Repository<Hospital>>(getRepositoryToken(Hospital));

  const newHospitals = [
    {
      name: 'Apollo Hospital',
      address: 'Indraprastha Apollo Hospitals, Sarita Vihar, New Delhi',
      phoneNumber: '+91-11-26925858',
      email: 'info@apollo.com',
      latitude: 28.5392,
      longitude: 77.2796,
      totalBeds: 1000,
      availableBeds: 120,
      userEmail: 'apollo@test.com'
    },
    {
      name: 'Max Super Speciality Hospital',
      address: 'Saket, New Delhi',
      phoneNumber: '+91-11-26515050',
      email: 'info@max.com',
      latitude: 28.5273,
      longitude: 77.2120,
      totalBeds: 800,
      availableBeds: 90,
      userEmail: 'max@test.com'
    },
    {
      name: 'Fortis Escorts Heart Institute',
      address: 'Okhla, New Delhi',
      phoneNumber: '+91-11-47135000',
      email: 'info@fortis.com',
      latitude: 28.5601,
      longitude: 77.2755,
      totalBeds: 500,
      availableBeds: 60,
      userEmail: 'fortis@test.com'
    },
    {
      name: 'Sir Ganga Ram Hospital',
      address: 'Rajinder Nagar, New Delhi',
      phoneNumber: '+91-11-25750000',
      email: 'info@sgrh.com',
      latitude: 28.6385,
      longitude: 77.1895,
      totalBeds: 675,
      availableBeds: 85,
      userEmail: 'sgrh@test.com'
    }
  ];

  console.log('Seeding new hospitals and users...');

  for (const h of newHospitals) {
    let hospital = await hospitalRepo.findOne({ where: { name: h.name } });
    if (!hospital) {
      hospital = hospitalRepo.create({
        name: h.name,
        address: h.address,
        phoneNumber: h.phoneNumber,
        email: h.email,
        latitude: h.latitude,
        longitude: h.longitude,
        totalBeds: h.totalBeds,
        availableBeds: h.availableBeds,
        status: 'ACCEPTING' as any
      });
      hospital = await hospitalRepo.save(hospital);
      console.log(`Created Hospital: ${h.name} -> ID: ${hospital.id}`);
    } else {
      console.log(`Hospital ${h.name} already exists -> ID: ${hospital.id}`);
    }

    const existingUser = await usersService.findByEmail(h.userEmail);
    if (!existingUser) {
      const user = await usersService.create({
        email: h.userEmail,
        password: 'password123',
        role: UserRole.HOSPITAL,
        profile: {
          firstName: h.name.split(' ')[0],
          lastName: 'Admin',
          phoneNumber: h.phoneNumber,
          address: h.address,
        }
      });
      
      // Manually update the user to link to hospital_id and set active
      const userRepo = app.get(getRepositoryToken(require('../src/users/entities/user.entity').User));
      await userRepo.update(user.id, { 
        hospitalId: hospital.id,
        isActive: true,
        emailVerified: true
      });

      console.log(`Created User: ${h.userEmail} -> ID: ${user.id}`);
    } else {
      console.log(`User ${h.userEmail} already exists -> ID: ${existingUser.id}`);
      
      // Ensure it's linked
      const userRepo = app.get(getRepositoryToken(require('../src/users/entities/user.entity').User));
      await userRepo.update(existingUser.id, { 
        hospitalId: hospital.id,
        isActive: true,
        emailVerified: true
      });
    }
  }

  console.log('Seeding complete!');
  await app.close();
}

bootstrap().catch(err => {
  console.error(err);
  process.exit(1);
});
