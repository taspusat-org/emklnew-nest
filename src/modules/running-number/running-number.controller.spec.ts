import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { RunningNumberController } from './running-number.controller';
import { RunningNumberService } from './running-number.service';

describe('RunningNumberController', () => {
  let controller: RunningNumberController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RunningNumberController],
      providers: [RunningNumberService],
    }).useMocker(autoMocker).compile();

    controller = module.get<RunningNumberController>(RunningNumberController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
