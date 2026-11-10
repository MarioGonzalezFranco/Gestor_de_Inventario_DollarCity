import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_URL } from '../config/constantes';
import { MatrizAbc, PeriodoAbc } from '../models/analisis.model';

@Injectable({ providedIn: 'root' })
export class AnalisisService {
  private readonly http = inject(HttpClient);

  /** Clasificación ABC de una ubicación con las ventas de los últimos `dias`. */
  matrizAbc(ubicacionId: number, dias: PeriodoAbc): Promise<MatrizAbc> {
    return firstValueFrom(
      this.http.get<MatrizAbc>(`${API_URL}/analisis/abc`, { params: { ubicacionId, dias } })
    );
  }
}