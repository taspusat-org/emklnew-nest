import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { BiayaemklController } from './biayaemkl.controller';
import { BiayaemklService } from './biayaemkl.service';

describe('BiayaemklController', () => {
  let controller: BiayaemklController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BiayaemklController],
      providers: [BiayaemklService],
    }).useMocker(autoMocker).compile();

    controller = module.get<BiayaemklController>(BiayaemklController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
