// Información del negocio. Editar aquí si cambian horarios, precios o datos de pago.
// Horarios: días 0=domingo … 6=sábado. null = cerrado. Horas en formato 24 h, hora de Guatemala.

module.exports = {
  nombre: 'Entre Montañas',
  whatsapp: '50239788113',
  telefono: '+502 3978 8113',
  zonaHoraria: 'America/Guatemala',

  pago: {
    banco: 'Banco Industrial',
    tipo: 'Cuenta monetaria',
    cuenta: '3840141547',
    titular: 'Restaurante Entre Montañas S.A.',
  },

  desayunos: { desde: '07:30', hasta: '12:00' },

  sucursales: [
    {
      id: 'amatitlan',
      nombre: 'Amatitlán',
      direccion: 'Municipio de Amatitlán, Chalet 16A, camino a La Barca',
      waze: 'https://waze.com/ul/h9fxd6njbg',
      horarioTexto: 'Martes a sábado 7:30 am – 8:00 pm · Domingo 7:30 am – 5:00 pm · Lunes cerrado',
      horario: {
        0: ['07:30', '17:00'], 1: null, 2: ['07:30', '20:00'], 3: ['07:30', '20:00'],
        4: ['07:30', '20:00'], 5: ['07:30', '20:00'], 6: ['07:30', '20:00'],
      },
      mesas: 12,
    },
    {
      id: 'villacanales',
      nombre: 'Villa Canales',
      direccion: 'Carretera Santa Elena Barillas Km 36.5, Col. Vista Encantada Casa 52, Villa Canales',
      waze: 'https://waze.com/ul/h9fx9gz2pb',
      horarioTexto: 'Lunes a domingo 7:00 am – 8:00 pm',
      horario: {
        0: ['07:00', '20:00'], 1: ['07:00', '20:00'], 2: ['07:00', '20:00'], 3: ['07:00', '20:00'],
        4: ['07:00', '20:00'], 5: ['07:00', '20:00'], 6: ['07:00', '20:00'],
      },
      mesas: 12,
    },
  ],

  reservaMesa: {
    deposito: 250,          // queda como saldo a favor en el consumo
    intervaloMin: 30,       // cada cuánto se ofrecen horarios
    ultimaAntesDeCierreMin: 90,
    maxPersonas: 40,
    diasAnticipacion: 60,
  },

  cabana: {
    nombre: 'Casa Alpina',
    sucursal: 'amatitlan',
    capacidadMin: 2,
    capacidadMax: 4,
    // precio por noche según el día en que inicia la noche
    precioNoche: { 0: 650, 1: 500, 2: 500, 3: 500, 4: 500, 5: 650, 6: 650 },
    checkIn: '14:00',
    checkOut: '12:00',
    maxNoches: 14,
    diasAnticipacion: 180,
    incluye: ['Cama matrimonial', 'Sofá cama', 'Aire acondicionado', 'Comedor', 'Televisor', 'WiFi', 'Frigobar', 'Baño privado', 'Parqueo privado para 1 vehículo'],
    desayunos: 'Incluye solo 2 desayunos',
    noIncluye: ['Piscina', 'Jacuzzi', 'Cocina', 'Mascotas'],
    politica: 'La reserva se confirma con el 100% del pago por transferencia. No hay devolución si no llegas a tu reserva.',
  },
};
