import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { ParameterController } from './parameter.controller';
import { ParameterService } from './parameter.service';

describe('ParameterController', () => {
  let controller: ParameterController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ParameterController],
      providers: [ParameterService],
    }).useMocker(autoMocker).compile();

    controller = module.get<ParameterController>(ParameterController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
