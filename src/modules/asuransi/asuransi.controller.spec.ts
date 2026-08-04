import { Test, TestingModule } from '@nestjs/testing';
import { AsuransiController } from './asuransi.controller';
import { AsuransiService } from './asuransi.service';

describe('AsuransiController', () => {
  let controller: AsuransiController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AsuransiController],
      providers: [AsuransiService],
    }).compile();

    controller = module.get<AsuransiController>(AsuransiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
