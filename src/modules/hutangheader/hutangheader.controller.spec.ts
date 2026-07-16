import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { HutangheaderController } from './hutangheader.controller';
import { HutangheaderService } from './hutangheader.service';

describe('HutangheaderController', () => {
  let controller: HutangheaderController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HutangheaderController],
      providers: [HutangheaderService],
    }).useMocker(autoMocker).compile();

    controller = module.get<HutangheaderController>(HutangheaderController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
