import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { PengeluaranheaderController } from './pengeluaranheader.controller';
import { PengeluaranheaderService } from './pengeluaranheader.service';

describe('PengeluaranheaderController', () => {
  let controller: PengeluaranheaderController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PengeluaranheaderController],
      providers: [PengeluaranheaderService],
    }).useMocker(autoMocker).compile();

    controller = module.get<PengeluaranheaderController>(
      PengeluaranheaderController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
