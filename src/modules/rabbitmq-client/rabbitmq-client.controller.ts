import { Controller } from '@nestjs/common';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  dbMssql,
  dbMdnEmkl,
  dbMdnTruck,
  dbbtgEmkl,
  dbjktEmkl,
  dbjktTrucking,
  dbmksEmkl,
  dbmksTrucking,
  dbsbyEmkl,
  dbsbyTrucking,
  dbsmgEmkl,
} from 'src/common/utils/db';

@Controller('rabbitmq-client')
export class RabbitmqClientController {
  constructor(private readonly rabbitmqService: RabbitmqService) {}

  @MessagePattern({ cmd: '26 RESIGN' }) // Pastikan '26' ini sesuai dengan yang dikirimkan
  async nonaktifAkunPusat(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    if (payload.kodeCabang === '26 RESIGN') {
      try {
        const nonaktif = await this.nonaktifkanAkunDiPusat(payload.id);

        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di PUSAT',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return {
            status: 'error',
            message: 'Gagal menonaktifkan akun di PUSAT',
          };
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di PUSAT: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }
  @MessagePattern({ cmd: '27 RESIGN' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async nonaktifAkunEmklMedan(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '27 RESIGN') {
      try {
        const nonaktif = await this.nonaktifEmklMedan(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }
  @MessagePattern({ cmd: '28 RESIGN' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async nonaktifAkunEmklJkt(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '28 RESIGN') {
      try {
        const nonaktif = await this.nonaktifEmklJkt(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }

  @MessagePattern({ cmd: '29 RESIGN' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async nonaktifAkunEmklSby(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '29 RESIGN') {
      try {
        const nonaktif = await this.nonaktifEmklSby(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }
  @MessagePattern({ cmd: '30 RESIGN' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async nonaktifAkunEmklMks(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '30 RESIGN') {
      try {
        const nonaktif = await this.nonaktifEmklMks(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }
  @MessagePattern({ cmd: '31 RESIGN' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async nonaktifAkunEmklBtg(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '31 RESIGN') {
      try {
        const nonaktif = await this.nonaktifEmklBtg(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }

  @MessagePattern({ cmd: '1135 RESIGN' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async nonaktifAkunEmklSmg(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '1135 RESIGN') {
      try {
        const nonaktif = await this.nonaktifEmklBtg(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }

  @MessagePattern({ cmd: '1136 RESIGN' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async nonaktifAkunTruckMdn(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '1136 RESIGN') {
      try {
        const nonaktif = await this.nonaktifTruckingMedan(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }

  @MessagePattern({ cmd: '26' }) // Pastikan '26' ini sesuai dengan yang dikirimkan
  async aktifAkunPusat(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    if (payload.kodeCabang === '26') {
      try {
        const nonaktif = await this.aktifkanAkunDiPusat(payload.id);

        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di PUSAT',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return {
            status: 'error',
            message: 'Gagal menonaktifkan akun di PUSAT',
          };
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di PUSAT: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }
  @MessagePattern({ cmd: '27' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async aktifAkunEmklMedan(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '27') {
      try {
        const nonaktif = await this.aktifEmklMedan(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }
  @MessagePattern({ cmd: '28' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async aktifAkunEmklJkt(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '28') {
      try {
        const nonaktif = await this.aktifEmklJkt(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }

  @MessagePattern({ cmd: '29' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async aktifAkunEmklSby(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '29') {
      try {
        const nonaktif = await this.aktifEmklSby(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }
  @MessagePattern({ cmd: '30' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async aktifAkunEmklMks(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '30') {
      try {
        const nonaktif = await this.aktifEmklMks(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }
  @MessagePattern({ cmd: '31' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async aktifAkunEmklBtg(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '31') {
      try {
        const nonaktif = await this.aktifEmklBtg(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }

  @MessagePattern({ cmd: '1135' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async aktifAkunEmklSmg(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '1135') {
      try {
        const nonaktif = await this.aktifEmklSmg(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }

  @MessagePattern({ cmd: '1136' }) // Pastikan '27' ini sesuai dengan yang dikirimkan
  async aktifAkunTruckMdn(@Payload() payload: any) {
    // Cek apakah kode cabang cocok
    // if (payload.kodeCabang === '27') {
    if (payload.kodeCabang === '1136') {
      try {
        const nonaktif = await this.aktifTruckingMedan(payload.id);
        // Jika nonaktif berhasil
        if (nonaktif) {
          return {
            status: 'success',
            message: 'Akun berhasil dinonaktifkan di cabang Medan',
          };
        } else {
          // Jika gagal menonaktifkan akun
          return false;
        }
      } catch (error) {
        console.error('Error menonaktifkan akun:', error);
        return {
          status: 'error',
          message: `Gagal menonaktifkan akun di cabang Medan: ${error.message}`,
        };
      }
    }

    // Jika kode cabang tidak cocok
    return {
      status: 'error',
      message: 'Kode cabang tidak ditemukan atau tidak valid',
    };
  }

  // Fungsi untuk menonaktifkan akun berdasarkan kar  async nonaktifkanAkunDiPusat(karyawan_id: string): Promise<boolean> {
  async nonaktifkanAkunDiPusat(karyawan_id: string): Promise<boolean> {
    try {
      // Ambil ID parameter yang menunjukkan status tidak aktif
      const nonaktif = await dbMssql('parameter')
        .where('grp', 'STATUS AKTIF')
        .where('text', 'TIDAK AKTIF');

      if (nonaktif.length === 0) {
        throw new Error('Parameter status tidak aktif tidak ditemukan');
      }

      // Update status akun karyawan menjadi tidak aktif
      const result = await dbMssql('users')
        .update('statusaktif', nonaktif[0].id)
        .where('karyawan_id', karyawan_id);

      if (result.length === 0) {
        throw new Error('Akun karyawan tidak ditemukan atau gagal di-update');
      }

      return true;
    } catch (error) {
      console.error('Error menonaktifkan akun di cabang Pusat:', error);
      return false; // Gagal menonaktifkan akun jika ada error
    }
  }

  async aktifkanAkunDiPusat(karyawan_id: string): Promise<boolean> {
    try {
      // Ambil ID parameter yang menunjukkan status tidak aktif
      const nonaktif = await dbMssql('parameter')
        .where('grp', 'STATUS AKTIF')
        .where('text', 'AKTIF');

      if (nonaktif.length === 0) {
        throw new Error('Parameter status tidak aktif tidak ditemukan');
      }

      // Update status akun karyawan menjadi tidak aktif
      const result = await dbMssql('users')
        .update('statusaktif', nonaktif[0].id)
        .where('karyawan_id', karyawan_id);

      if (result.length === 0) {
        throw new Error('Akun karyawan tidak ditemukan atau gagal di-update');
      }

      return true;
    } catch (error) {
      console.error('Error menonaktifkan akun di cabang Pusat:', error);
      return false; // Gagal menonaktifkan akun jika ada error
    }
  }

  async nonaktifEmklMedan(karyawan_id: string): Promise<boolean> {
    try {
      // Cek apakah karyawan ada di fuserlist
      const checkUser = await dbMdnEmkl('fuserlist')
        .where('FIDKaryawan', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUser) {
        const deleteResult = await dbMdnEmkl('fuserlist')
          .where('FIDKaryawan', karyawan_id)
          .del();
        if (deleteResult === 0) return false; // Tidak ada baris yang terhapus
      }

      // Cek apakah karyawan ada di MMarketing
      const checkMarketing = await dbMdnEmkl('MMarketing')
        .where('FIDKaryawan', karyawan_id)
        .first();

      if (checkMarketing) {
        const updateResult = await dbMdnEmkl('MMarketing')
          .update({
            FAktif: 0,
            FEmail: '',
            FEmailNoShipperOrderan: '',
            FEmailTracing: '',
          })
          .where('FIDKaryawan', karyawan_id);

        if (updateResult === 0) return false; // Tidak ada baris yang terupdate
      }
      const checkUserTruck = await dbMdnTruck('user')
        .where('karyawan_id', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUserTruck) {
        const updateResult = await dbMdnTruck('user')
          .update({
            statusaktif: 0,
          })
          .where('karyawan_id', karyawan_id);
        if (updateResult === 0) return false; // Tidak ada baris yang terhapus
      }
      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error menonaktifkan akun di cabang Medan:', error);
      return false; // Gagal menonaktifkan akun jika ada error
    }
  }
  async nonaktifTruckingMedan(karyawan_id: string): Promise<boolean> {
    try {
      // Cek apakah karyawan ada di fuserlist
      const checkUser = await dbMdnTruck('user')
        .where('karyawan_id', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUser) {
        const updateResult = await dbMdnTruck('user')
          .update({
            statusaktif: 0,
          })
          .where('karyawan_id', karyawan_id);
        if (updateResult === 0) return false; // Tidak ada baris yang terhapus
      }

      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error menonaktifkan akun di cabang TruckingMedan:', error);
      return false; // Gagal menonaktifkan akun jika ada error
    }
  }

  async nonaktifEmklJkt(karyawan_id: string): Promise<boolean> {
    try {
      // Cek apakah karyawan ada di fuserlist
      const checkUser = await dbjktEmkl('fuserlist')
        .where('FIDKaryawan', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUser) {
        const deleteResult = await dbjktEmkl('fuserlist')
          .where('FIDKaryawan', karyawan_id)
          .del();
        if (deleteResult === 0) return false; // Tidak ada baris yang terhapus
      }

      // Cek apakah karyawan ada di MMarketing
      const checkMarketing = await dbjktEmkl('MMarketing')
        .where('FIDKaryawan', karyawan_id)
        .first();

      if (checkMarketing) {
        const updateResult = await dbjktEmkl('MMarketing')
          .update({
            FAktif: 0,
            FEmail: '',
            FEmailNoShipperOrderan: '',
            FEmailTracing: '',
          })
          .where('FIDKaryawan', karyawan_id);

        if (updateResult === 0) return false; // Tidak ada baris yang terupdate
      }
      const checkUserTruck = await dbjktTrucking('user')
        .where('karyawan_id', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUserTruck) {
        const updateResult = await dbjktTrucking('user')
          .update({
            statusaktif: 0,
          })
          .where('karyawan_id', karyawan_id);
        if (updateResult === 0) return false; // Tidak ada baris yang terhapus
      }
      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error menonaktifkan akun di cabang Jakarta:', error);
      return false; // Gagal menonaktifkan akun jika ada error
    }
  }
  // async nonaktifTruckingJkt(karyawan_id: string): Promise<boolean> {
  //   try {
  //     // Cek apakah karyawan ada di fuserlist
  //     const checkUser = await dbjktTrucking('user')
  //       .where('karyawan_id', karyawan_id)
  //       .first();

  //     // Jika ada, hapus user tersebut
  //     if (checkUser) {
  //       const updateResult = await dbjktTrucking('user')
  //         .update({
  //           statusaktif: 0,
  //         })
  //         .where('karyawan_id', karyawan_id);
  //       if (updateResult === 0) return false; // Tidak ada baris yang terhapus
  //     }

  //     return true; // Jika semuanya sukses
  //   } catch (error) {
  //     console.error('Error menonaktifkan akun di cabang:', error);
  //     return false; // Gagal menonaktifkan akun jika ada error
  //   }
  // }
  async nonaktifEmklSby(karyawan_id: string): Promise<boolean> {
    try {
      // Cek apakah karyawan ada di fuserlist
      const checkUser = await dbsbyEmkl('fuserlist')
        .where('FIDKaryawan', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUser) {
        const deleteResult = await dbsbyEmkl('fuserlist')
          .where('FIDKaryawan', karyawan_id)
          .del();
        if (deleteResult === 0) return false; // Tidak ada baris yang terhapus
      }

      // Cek apakah karyawan ada di MMarketing
      const checkMarketing = await dbsbyEmkl('MMarketing')
        .where('FIDKaryawan', karyawan_id)
        .first();

      if (checkMarketing) {
        const updateResult = await dbsbyEmkl('MMarketing')
          .update({
            FAktif: 0,
            FEmail: '',
            FEmailNoShipperOrderan: '',
            FEmailTracing: '',
          })
          .where('FIDKaryawan', karyawan_id);

        if (updateResult === 0) return false; // Tidak ada baris yang terupdate
      }
      const checkUserTruck = await dbsbyTrucking('user')
        .where('karyawan_id', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUserTruck) {
        const updateResult = await dbsbyTrucking('user')
          .update({
            statusaktif: 0,
          })
          .where('karyawan_id', karyawan_id);
        if (updateResult === 0) return false; // Tidak ada baris yang terhapus
      }
      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error menonaktifkan akun di cabang Surabaya:', error);
      return false; // Gagal menonaktifkan akun jika ada error
    }
  }
  // async nonaktifTruckingSby(karyawan_id: string): Promise<boolean> {
  //   try {
  //     // Cek apakah karyawan ada di fuserlist
  //     const checkUser = await dbsbyTrucking('user')
  //       .where('karyawan_id', karyawan_id)
  //       .first();

  //     // Jika ada, hapus user tersebut
  //     if (checkUser) {
  //       const updateResult = await dbsbyTrucking('user')
  //         .update({
  //           statusaktif: 0,
  //         })
  //         .where('karyawan_id', karyawan_id);
  //       if (updateResult === 0) return false; // Tidak ada baris yang terhapus
  //     }

  //     return true; // Jika semuanya sukses
  //   } catch (error) {
  //     console.error('Error menonaktifkan akun di cabang:', error);
  //     return false; // Gagal menonaktifkan akun jika ada error
  //   }
  // }
  async nonaktifEmklSmg(karyawan_id: string): Promise<boolean> {
    try {
      // Cek apakah karyawan ada di fuserlist
      const checkUser = await dbsmgEmkl('fuserlist')
        .where('FIDKaryawan', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUser) {
        const deleteResult = await dbsmgEmkl('fuserlist')
          .where('FIDKaryawan', karyawan_id)
          .del();
        if (deleteResult === 0) return false; // Tidak ada baris yang terhapus
      }

      // Cek apakah karyawan ada di MMarketing
      const checkMarketing = await dbsmgEmkl('MMarketing')
        .where('FIDKaryawan', karyawan_id)
        .first();

      if (checkMarketing) {
        const updateResult = await dbsmgEmkl('MMarketing')
          .update({
            FAktif: 0,
            FEmail: '',
            FEmailNoShipperOrderan: '',
            FEmailTracing: '',
          })
          .where('FIDKaryawan', karyawan_id);

        if (updateResult === 0) return false; // Tidak ada baris yang terupdate
      }

      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error menonaktifkan akun di cabang Semarang:', error);
      return false; // Gagal menonaktifkan akun jika ada error
    }
  }

  async nonaktifEmklMks(karyawan_id: string): Promise<boolean> {
    try {
      // Cek apakah karyawan ada di fuserlist
      const checkUser = await dbmksEmkl('fuserlist')
        .where('FIDKaryawan', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUser) {
        const deleteResult = await dbmksEmkl('fuserlist')
          .where('FIDKaryawan', karyawan_id)
          .del();
        if (deleteResult === 0) return false; // Tidak ada baris yang terhapus
      }

      // Cek apakah karyawan ada di MMarketing
      const checkMarketing = await dbmksEmkl('MMarketing')
        .where('FIDKaryawan', karyawan_id)
        .first();

      if (checkMarketing) {
        const updateResult = await dbmksEmkl('MMarketing')
          .update({
            FAktif: 0,
            FEmail: '',
            FEmailNoShipperOrderan: '',
            FEmailTracing: '',
          })
          .where('FIDKaryawan', karyawan_id);

        if (updateResult === 0) return false; // Tidak ada baris yang terupdate
      }
      const checkUserTruck = await dbmksTrucking('user')
        .where('karyawan_id', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUserTruck) {
        const updateResult = await dbmksTrucking('user')
          .update({
            statusaktif: 0,
          })
          .where('karyawan_id', karyawan_id);
        if (updateResult === 0) return false; // Tidak ada baris yang terhapus
      }
      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error menonaktifkan akun di cabang Makassar:', error);
      return false; // Gagal menonaktifkan akun jika ada error
    }
  }
  // async nonaktifTruckingMks(karyawan_id: string): Promise<boolean> {
  //   try {
  //     // Cek apakah karyawan ada di fuserlist
  //     const checkUser = await dbmksTrucking('user')
  //       .where('karyawan_id', karyawan_id)
  //       .first();

  //     // Jika ada, hapus user tersebut
  //     if (checkUser) {
  //       const updateResult = await dbmksTrucking('user')
  //         .update({
  //           statusaktif: 0,
  //         })
  //         .where('karyawan_id', karyawan_id);
  //       if (updateResult === 0) return false; // Tidak ada baris yang terhapus
  //     }

  //     return true; // Jika semuanya sukses
  //   } catch (error) {
  //     console.error('Error menonaktifkan akun di cabang:', error);
  //     return false; // Gagal menonaktifkan akun jika ada error
  //   }
  // }
  async nonaktifEmklBtg(karyawan_id: string): Promise<boolean> {
    try {
      // Cek apakah karyawan ada di fuserlist
      const checkUser = await dbbtgEmkl('fuserlist')
        .where('FIDKaryawan', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUser) {
        const deleteResult = await dbbtgEmkl('fuserlist')
          .where('FIDKaryawan', karyawan_id)
          .del();
        if (deleteResult === 0) return false; // Tidak ada baris yang terhapus
      }

      // Cek apakah karyawan ada di MMarketing
      const checkMarketing = await dbbtgEmkl('MMarketing')
        .where('FIDKaryawan', karyawan_id)
        .first();

      if (checkMarketing) {
        const updateResult = await dbbtgEmkl('MMarketing')
          .update({
            FAktif: 0,
            FEmail: '',
            FEmailNoShipperOrderan: '',
            FEmailTracing: '',
          })
          .where('FIDKaryawan', karyawan_id);

        if (updateResult === 0) return false; // Tidak ada baris yang terupdate
      }

      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error menonaktifkan akun di cabang Bitung:', error);
      return false; // Gagal menonaktifkan akun jika ada error
    }
  }

  async aktifEmklMedan(karyawan_id: string): Promise<boolean> {
    try {
      const checkMarketing = await dbMdnEmkl('MMarketing')
        .where('FIDKaryawan', karyawan_id)
        .first();

      if (checkMarketing) {
        const updateResult = await dbMdnEmkl('MMarketing')
          .update({
            FAktif: 1,
          })
          .where('FIDKaryawan', karyawan_id);

        if (updateResult === 0) return false; // Tidak ada baris yang terupdate
      }
      const checkUserTruck = await dbMdnTruck('user')
        .where('karyawan_id', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUserTruck) {
        const updateResult = await dbMdnTruck('user')
          .update({
            statusaktif: 1,
          })
          .where('karyawan_id', karyawan_id);
        if (updateResult === 0) return false; // Tidak ada baris yang terhapus
      }
      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error meaktifkan akun di cabang Medan:', error);
      return false; // Gagal meaktifkan akun jika ada error
    }
  }
  async aktifTruckingMedan(karyawan_id: string): Promise<boolean> {
    try {
      // Cek apakah karyawan ada di fuserlist
      const checkUser = await dbMdnTruck('user')
        .where('karyawan_id', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUser) {
        const updateResult = await dbMdnTruck('user')
          .update({
            statusaktif: 1,
          })
          .where('karyawan_id', karyawan_id);
        if (updateResult === 0) return false; // Tidak ada baris yang terhapus
      }

      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error meaktifkan akun di cabang Trucking Medan:', error);
      return false; // Gagal menonaktifkan akun jika ada error
    }
  }
  async aktifEmklJkt(karyawan_id: string): Promise<boolean> {
    try {
      const checkMarketing = await dbjktEmkl('MMarketing')
        .where('FIDKaryawan', karyawan_id)
        .first();

      if (checkMarketing) {
        const updateResult = await dbjktEmkl('MMarketing')
          .update({
            FAktif: 1,
          })
          .where('FIDKaryawan', karyawan_id);

        if (updateResult === 0) return false; // Tidak ada baris yang terupdate
      }
      const checkUserTruck = await dbjktTrucking('user')
        .where('karyawan_id', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUserTruck) {
        const updateResult = await dbjktTrucking('user')
          .update({
            statusaktif: 1,
          })
          .where('karyawan_id', karyawan_id);
        if (updateResult === 0) return false; // Tidak ada baris yang terhapus
      }
      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error meaktifkan akun di cabang Jakarta:', error);
      return false; // Gagal meaktifkan akun jika ada error
    }
  }
  // async aktifTruckingJkt(karyawan_id: string): Promise<boolean> {
  //   try {
  //     // Cek apakah karyawan ada di fuserlist
  //     const checkUser = await dbjktTrucking('user')
  //       .where('karyawan_id', karyawan_id)
  //       .first();

  //     // Jika ada, hapus user tersebut
  //     if (checkUser) {
  //       const updateResult = await dbjktTrucking('user')
  //         .update({
  //           statusaktif: 1,
  //         })
  //         .where('karyawan_id', karyawan_id);
  //       if (updateResult === 0) return false; // Tidak ada baris yang terhapus
  //     }

  //     return true; // Jika semuanya sukses
  //   } catch (error) {
  //     console.error('Error meaktifkan akun di cabang:', error);
  //     return false; // Gagal menonaktifkan akun jika ada error
  //   }
  // }
  async aktifEmklSby(karyawan_id: string): Promise<boolean> {
    try {
      const checkMarketing = await dbsbyEmkl('MMarketing')
        .where('FIDKaryawan', karyawan_id)
        .first();

      if (checkMarketing) {
        const updateResult = await dbsbyEmkl('MMarketing')
          .update({
            FAktif: 1,
          })
          .where('FIDKaryawan', karyawan_id);

        if (updateResult === 0) return false; // Tidak ada baris yang terupdate
      }
      const checkUser = await dbsbyTrucking('user')
        .where('karyawan_id', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUser) {
        const updateResult = await dbsbyTrucking('user')
          .update({
            statusaktif: 1,
          })
          .where('karyawan_id', karyawan_id);
        if (updateResult === 0) return false; // Tidak ada baris yang terhapus
      }

      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error meaktifkan akun di cabang Surabaya:', error);
      return false; // Gagal meaktifkan akun jika ada error
    }
  }
  // async aktifTruckingSby(karyawan_id: string): Promise<boolean> {
  //   try {
  //     // Cek apakah karyawan ada di fuserlist
  //     const checkUser = await dbsbyTrucking('user')
  //       .where('karyawan_id', karyawan_id)
  //       .first();

  //     // Jika ada, hapus user tersebut
  //     if (checkUser) {
  //       const updateResult = await dbsbyTrucking('user')
  //         .update({
  //           statusaktif: 1,
  //         })
  //         .where('karyawan_id', karyawan_id);
  //       if (updateResult === 0) return false; // Tidak ada baris yang terhapus
  //     }

  //     return true; // Jika semuanya sukses
  //   } catch (error) {
  //     console.error('Error meaktifkan akun di cabang:', error);
  //     return false; // Gagal menonaktifkan akun jika ada error
  //   }
  // }
  async aktifEmklSmg(karyawan_id: string): Promise<boolean> {
    try {
      const checkMarketing = await dbsmgEmkl('MMarketing')
        .where('FIDKaryawan', karyawan_id)
        .first();

      if (checkMarketing) {
        const updateResult = await dbsmgEmkl('MMarketing')
          .update({
            FAktif: 1,
          })
          .where('FIDKaryawan', karyawan_id);

        if (updateResult === 0) return false; // Tidak ada baris yang terupdate
      }

      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error meaktifkan akun di cabang Semarang:', error);
      return false; // Gagal meaktifkan akun jika ada error
    }
  }
  async aktifEmklMks(karyawan_id: string): Promise<boolean> {
    try {
      const checkMarketing = await dbmksEmkl('MMarketing')
        .where('FIDKaryawan', karyawan_id)
        .first();

      if (checkMarketing) {
        const updateResult = await dbmksEmkl('MMarketing')
          .update({
            FAktif: 1,
          })
          .where('FIDKaryawan', karyawan_id);

        if (updateResult === 0) return false; // Tidak ada baris yang terupdate
      }
      const checkUser = await dbmksTrucking('user')
        .where('karyawan_id', karyawan_id)
        .first();

      // Jika ada, hapus user tersebut
      if (checkUser) {
        const updateResult = await dbmksTrucking('user')
          .update({
            statusaktif: 1,
          })
          .where('karyawan_id', karyawan_id);
        if (updateResult === 0) return false; // Tidak ada baris yang terhapus
      }
      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error meaktifkan akun di cabang Makassar:', error);
      return false; // Gagal meaktifkan akun jika ada error
    }
  }
  // async aktifTruckingMks(karyawan_id: string): Promise<boolean> {
  //   try {
  //     // Cek apakah karyawan ada di fuserlist
  //     const checkUser = await dbmksTrucking('user')
  //       .where('karyawan_id', karyawan_id)
  //       .first();

  //     // Jika ada, hapus user tersebut
  //     if (checkUser) {
  //       const updateResult = await dbmksTrucking('user')
  //         .update({
  //           statusaktif: 1,
  //         })
  //         .where('karyawan_id', karyawan_id);
  //       if (updateResult === 0) return false; // Tidak ada baris yang terhapus
  //     }

  //     return true; // Jika semuanya sukses
  //   } catch (error) {
  //     console.error('Error meaktifkan akun di cabang:', error);
  //     return false; // Gagal menonaktifkan akun jika ada error
  //   }
  // }
  async aktifEmklBtg(karyawan_id: string): Promise<boolean> {
    try {
      const checkMarketing = await dbbtgEmkl('MMarketing')
        .where('FIDKaryawan', karyawan_id)
        .first();

      if (checkMarketing) {
        const updateResult = await dbbtgEmkl('MMarketing')
          .update({
            FAktif: 1,
          })
          .where('FIDKaryawan', karyawan_id);

        if (updateResult === 0) return false; // Tidak ada baris yang terupdate
      }

      return true; // Jika semuanya sukses
    } catch (error) {
      console.error('Error meaktifkan akun di cabang Bitung:', error);
      return false; // Gagal meaktifkan akun jika ada error
    }
  }
}
