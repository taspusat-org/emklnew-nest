import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateUseraclDto } from './dto/create-useracl.dto';
import { UpdateUseraclDto } from './dto/update-useracl.dto';
import { dbMssql } from 'src/common/utils/db';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';

@Injectable()
export class UseraclService {
  constructor(private readonly utilsService: UtilsService) {}
  private readonly logger = new Logger(UseraclService.name);
  create(createUseraclDto: CreateUseraclDto) {
    return 'This action adds a new useracl';
  }

  async findAll(userId: string) {
    this.logger.log(`Fetching ACL for user ID: ${userId}`);

    try {
      const result = await dbMssql('useracl as ua')
        .select(['ua.user_id as userId', 'a.*'])
        .leftJoin('acos as a', 'ua.aco_id', 'a.id')
        .where('ua.user_id', userId);

      if (!result.length) {
        this.logger.warn(`No ACL found for user ID: ${userId}`);
        return {
          status: false,
          message: 'No ACL data found for the given user ID',
          data: [],
        };
      }

      return {
        status: true,
        message: 'ACL data fetched successfully',
        data: result,
      };
    } catch (error) {
      this.logger.error('Error fetching user ACL', error.stack);
      throw new Error('Failed to fetch user ACL');
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} useracl`;
  }

  async update(id: string, acoIds: number[], modifiedBy: string, trx: any) {
    try {
      console.log('acoIds', acoIds);
      if (acoIds.length === 0) {
        await trx('useracl').where('user_id', id).del();
        const { abilities } =
          await this.utilsService.fetchUserRolesAndAbilities(id, trx);
        console.log('abilities', abilities);
        // Update menu after roles and ACL updates
        const menuData = await this.utilsService.getDataMenuSidebar(trx);
        const menuString = this.utilsService.buildMenuString(
          menuData,
          abilities,
        );

        await trx('users').update({ menu: menuString }).where('id', id);
        return {
          status: true,
          message: 'All ACL entries deleted successfully',
        };
      }

      const userAclData = acoIds.map((acoId) => ({
        user_id: id,
        aco_id: acoId,
        modifiedby: modifiedBy,
        created_at: dbMssql.fn.now(),
        updated_at: dbMssql.fn.now(),
      }));
      await trx('useracl').insert(await withUuidV7(trx, userAclData));
      const { abilities } = await this.utilsService.fetchUserRolesAndAbilities(
        id,
        trx,
      );

      // Update menu after roles and ACL updates
      const menuData = await this.utilsService.getDataMenuSidebar(trx);
      const menuString = this.utilsService.buildMenuString(menuData, abilities);
      await trx('users').update({ menu: menuString }).where('id', id);
      return { status: true, message: 'USER and ACL updated successfully' };
    } catch (error) {
      console.error('Error updating user and ACL:', error);
      throw new InternalServerErrorException('Failed to update user and ACL');
    }
  }

  remove(id: string) {
    return `This action removes a #${id} useracl`;
  }
}
