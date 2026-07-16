import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { HargatruckingService } from './hargatrucking.service';

describe('HargatruckingService', () => {
  let service: HargatruckingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HargatruckingService],
    }).useMocker(autoMocker).compile();

    service = module.get<HargatruckingService>(HargatruckingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
