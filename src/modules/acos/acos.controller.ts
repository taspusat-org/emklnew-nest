import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { AcosService } from './acos.service';
import { AuthRequest } from 'src/common/interfaces/auth-user.interface';
import { AuthGuard } from '../auth/auth.guard';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';

@Controller('acos')
export class AcosController {
  constructor(private readonly acosService: AcosService) {}

  @UseGuards(AuthGuard) // Ensure the user is logged in before synchronization
  @Post('sync')
  //@SYNC-ACOS
  async syncAcos(@Req() req: AuthRequest) {
    const name = req.user?.email || 'system'; // Get the username of the logged-in user
    try {
      const syncResult = await this.acosService.syncAcos(name);

      if (syncResult.success) {
        return {
          statusCode: 200,
          message: 'ACOS sync successful.',
          data: syncResult.data,
        };
      } else {
        return {
          statusCode: 400,
          message: syncResult.message,
        };
      }
    } catch (error) {
      console.error('Error syncing ACOS:', error);
      return {
        statusCode: 500,
        message: 'An unexpected error occurred while syncing ACOS.',
        error: error.message,
      };
    }
  }

  @Get('get-all')
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    // Handle isLookUp separately, remove it from filters
    const sortParams = {
      sortBy: sortBy || 'class',
      sortDirection: sortDirection || 'asc',
    };

    const pagination = {
      page: page || 1, // Jika page tidak ada, set ke 1
      limit: limit === 0 || !limit ? undefined : limit, // Jika limit 0, tidak ada pagination
    };

    // Set isLookUp as a separate parameter
    const params: FindAllParams = {
      search,
      filters,
      pagination,
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
      isLookUp: isLookUp === 'true', // Convert isLookUp to boolean
    };
    return this.acosService.findAll(params);
  }
  @Get()
  findAllAcosGet() {
    return this.acosService.getDataAcosWithMethod();
  }
}
