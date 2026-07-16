import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { HutangdetailController } from './hutangdetail.controller';
import { HutangdetailService } from './hutangdetail.service';

describe('HutangdetailController', () => {
  let controller: HutangdetailController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HutangdetailController],
      providers: [HutangdetailService],
    }).useMocker(autoMocker).compile();

    controller = module.get<HutangdetailController>(HutangdetailController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
