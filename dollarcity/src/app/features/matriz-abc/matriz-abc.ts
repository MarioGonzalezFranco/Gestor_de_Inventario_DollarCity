import { Component } from '@angular/core';

@Component({
  selector: 'app-matriz-abc',
  template: `
    <section class="pagina">
      <header class="encabezado">
        <div>
          <span class="etiqueta">Análisis de rentabilidad</span>
          <h1>Matriz de Clasificación ABC</h1>
        </div>
      </header>
      <div class="card pendiente">
        <span class="etiqueta">Pantalla en construcción</span>
        <p>Curva de Pareto, tarjetas por clase A, B y C, y la tabla de SKUs con rotación y valor generado.</p>
      </div>
    </section>
  `,
  styleUrl: '../pagina.css'
})
export class MatrizAbc {}