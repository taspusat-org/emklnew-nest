import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { DaftarblController } from './daftarbl.controller';
import { DaftarblService } from './daftarbl.service';

describe('DaftarblController', () => {
  let controller: DaftarblController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DaftarblController],
      providers: [DaftarblService],
    }).useMocker(autoMocker).compile();

    controller = module.get<DaftarblController>(DaftarblController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
