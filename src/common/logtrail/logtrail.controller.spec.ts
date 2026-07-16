import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { LogtrailController } from './logtrail.controller';
import { LogtrailService } from './logtrail.service';

describe('LogtrailController', () => {
  let controller: LogtrailController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LogtrailController],
      providers: [LogtrailService],
    }).useMocker(autoMocker).compile();

    controller = module.get<LogtrailController>(LogtrailController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
