import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateUserroleDto } from './dto/create-userrole.dto';
import { UpdateUserroleDto } from './dto/update-userrole.dto';
import { dbMssql } from 'src/common/utils/db';
import { uuidV7, UtilsService } from 'src/utils/utils.service';

@Injectable()
export class UserroleService {
  constructor(private readonly utilsService: UtilsService) {}
  private readonly logger = new Logger(UserroleService.name);
  create(createUserroleDto: CreateUserroleDto) {
    return 'This action adds a new userrole';
  }

  async findAll(userId: number) {
    this.logger.log(`Fetching ACL for role ID: ${userId}`);

    try {
      const result = await dbMssql('userrole as ur')
        .select(['ur.user_id as userId', 'r.*'])
        .leftJoin('role as r', 'ur.role_id', 'r.id')
        .where('ur.user_id', userId);
      if (!result.length) {
        this.logger.warn(`No ACL found for user ID: ${userId}`);
        return {
          status: false,
          message: 'No ACL data found for the given user ID',
          data: [],
        };
      }

      return { data: result };
    } catch (error) {
      this.logger.error('Error fetching role ACL', error.stack);
      throw new Error('Failed to fetch role ACL');
    }
  }

  async update(
    id: number,
    updateUserroleDto: UpdateUserroleDto,
    modifiedBy: string,
    trx: any,
  ) {
    try {
      const { roleIds } = updateUserroleDto;

      // Jika roleIds null, kita asumsikan tidak ada role yang diberikan.
      // Contoh: hapus semua role user atau set roleIds ke array kosong.
      if (!roleIds) {
        await trx('userrole').where('user_id', id).delete();
        return { status: true, message: 'User roles updated successfully' };
      }
      // Loop untuk setiap roleId yang diterima
      for (const roleId of roleIds) {
        const existingRole = await trx('userrole')
          .where('user_id', id)
          .andWhere('role_id', roleId)
          .first();

        if (existingRole) {
          await trx('userrole')
            .where('user_id', id)
            .andWhere('role_id', roleId)
            .update({
              modifiedby: modifiedBy,
              updated_at: dbMssql.fn.now(),
            });
        } else {
          await trx('userrole').insert({
            id: await uuidV7(trx),
            user_id: id,
            role_id: roleId,
            modifiedby: modifiedBy,
            created_at: dbMssql.fn.now(),
            updated_at: dbMssql.fn.now(),
          });
        }
      }

      // Hapus role yang tidak termasuk dalam roleIds
      await trx('userrole')
        .where('user_id', id)
        .whereNotIn('role_id', roleIds)
        .delete();
      const { abilities } = await this.utilsService.fetchUserRolesAndAbilities(
        id,
        trx,
      );

      // Update menu after roles and ACL updates
      const menuData = await this.utilsService.getDataMenuSidebar(trx);
      const menuString = this.utilsService.buildMenuString(menuData, abilities);
      await trx('users').update({ menu: menuString }).where('id', id);
      return { status: true, message: 'User roles updated successfully' };
    } catch (error) {
      console.error('Error updating user roles in service:', error);
      throw new InternalServerErrorException('Failed to update user roles');
    }
  }

  remove(id: string) {
    return `This action removes a #${id} userrole`;
  }
}
