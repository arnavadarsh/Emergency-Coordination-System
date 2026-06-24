import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddCoordinatesToUserProfile1706500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'user_profiles',
      new TableColumn({
        name: 'latitude',
        type: 'decimal',
        precision: 10,
        scale: 8,
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      'user_profiles',
      new TableColumn({
        name: 'longitude',
        type: 'decimal',
        precision: 11,
        scale: 8,
        isNullable: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('user_profiles', 'longitude');
    await queryRunner.dropColumn('user_profiles', 'latitude');
  }
}
