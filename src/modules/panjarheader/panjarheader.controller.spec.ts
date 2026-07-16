import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { PanjarheaderController } from './panjarheader.controller';
import { PanjarheaderService } from './panjarheader.service';

describe('PanjarheaderController', () => {
  let controller: PanjarheaderController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PanjarheaderController],
      providers: [PanjarheaderService],
    }).useMocker(autoMocker).compile();

    controller = module.get<PanjarheaderController>(PanjarheaderController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
