import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateRoleaclDto } from './dto/create-roleacl.dto';
import { UpdateRoleaclDto } from './dto/update-roleacl.dto';
import { dbMssql } from 'src/common/utils/db';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';

@Injectable()
export class RoleaclService {
  constructor(private readonly utilsService: UtilsService) {}
  private readonly logger = new Logger(RoleaclService.name);
  private readonly TABLE_ACL = 'acl';
  private readonly TABLE_ACOS = 'acos';

  create(createRoleaclDto: CreateRoleaclDto) {
    return 'This action adds a new roleacl';
  }

  async findAll(roleId: string) {
    this.logger.log(`Fetching ACL for role ID: ${roleId}`);

    try {
      if (!roleId) {
        this.logger.error('Invalid role ID');
        throw new BadRequestException('Invalid role ID');
      }

      const result = await dbMssql(this.TABLE_ACL)
        .join(
          this.TABLE_ACOS,
          `${this.TABLE_ACL}.aco_id`,
          '=',
          `${this.TABLE_ACOS}.id`,
        )
        .where(`${this.TABLE_ACL}.role_id`, roleId)
        .select(
          `${this.TABLE_ACOS}.id`,
          `${this.TABLE_ACOS}.class`,
          `${this.TABLE_ACOS}.method`,
          `${this.TABLE_ACOS}.nama`,
        );

      if (!result.length) {
        this.logger.warn(`No ACL found for user ID: ${roleId}`);
        return {
          status: false,
          message: 'No ACL data found for the given user ID',
          data: [],
        };
      }
      return { data: result };
    } catch (error) {
      this.logger.error('Error fetching role ACL', error.stack);
      // Don't mask client errors (e.g. BadRequestException) as a 500 — rethrow
      // HttpExceptions as-is so the caller gets the correct status code.
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to fetch role ACL');
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} roleacl`;
  }

  async update(id: string, acoIds: number[], modifiedBy: string, trx: any) {
    try {
      if (acoIds.length === 0) {
        await trx('acl').where('role_id', id).del();
        return {
          status: true,
          message: 'All ACL entries deleted successfully',
        };
      }

      await trx('acl').where('role_id', id).del();

      const aclData = acoIds.map((acoId) => ({
        role_id: id,
        aco_id: acoId,
        modifiedby: modifiedBy,
        created_at: dbMssql.fn.now(),
        updated_at: dbMssql.fn.now(),
      }));

      await trx('acl').insert(await withUuidV7(trx, aclData));

      const usersRole = await trx('userrole')
        .select('user_id')
        .where('role_id', id);

      for (const user of usersRole) {
        const { abilities } =
          await this.utilsService.fetchUserRolesAndAbilities(user.user_id, trx);

        const menuData = await this.utilsService.getDataMenuSidebar(trx);

        const menuString = this.utilsService.buildMenuString(
          menuData,
          abilities,
        );
        await trx('users').where({ id: user.user_id }).update({
          menu: menuString,
          updated_at: new Date(),
        });
      }
      return { status: true, message: 'Role and ACL updated successfully' };
    } catch (error) {
      console.error('Error updating role and ACL:', error);
      throw new InternalServerErrorException('Failed to update role and ACL');
    }
  }

  remove(id: string) {
    return `This action removes a #${id} roleacl`;
  }
}
