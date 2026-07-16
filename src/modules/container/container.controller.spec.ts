import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { ContainerController } from './container.controller';
import { ContainerService } from './container.service';

describe('ContainerController', () => {
  let controller: ContainerController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContainerController],
      providers: [ContainerService],
    }).useMocker(autoMocker).compile();

    controller = module.get<ContainerController>(ContainerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
