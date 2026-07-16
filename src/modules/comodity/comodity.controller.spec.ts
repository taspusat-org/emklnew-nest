import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { ComodityController } from './comodity.controller';
import { ComodityService } from './comodity.service';

describe('ComodityController', () => {
  let controller: ComodityController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ComodityController],
      providers: [ComodityService],
    }).useMocker(autoMocker).compile();

    controller = module.get<ComodityController>(ComodityController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
