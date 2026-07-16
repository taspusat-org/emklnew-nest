import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { CabangController } from './cabang.controller';
import { CabangService } from './cabang.service';

describe('CabangController', () => {
  let controller: CabangController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CabangController],
      providers: [CabangService],
    }).useMocker(autoMocker).compile();

    controller = module.get<CabangController>(CabangController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
