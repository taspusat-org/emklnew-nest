import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { AkuntansiController } from './akuntansi.controller';
import { AkuntansiService } from './akuntansi.service';

describe('AkuntansiController', () => {
  let controller: AkuntansiController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AkuntansiController],
      providers: [AkuntansiService],
    }).useMocker(autoMocker).compile();

    controller = module.get<AkuntansiController>(AkuntansiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
