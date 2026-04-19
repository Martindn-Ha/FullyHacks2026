import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CgmSessionProvider } from './src/context/CgmSessionContext';
import { EventsScreen } from './src/screens/EventsScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { RecommendationsScreen } from './src/screens/RecommendationsScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <CgmSessionProvider>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#7dd3fc',
          tabBarInactiveTintColor: '#94a3b8',
          tabBarStyle: {
            backgroundColor: 'rgba(6, 26, 46, 0.96)',
            borderTopWidth: 1,
            borderTopColor: '#1e3a52',
          },
          tabBarLabelStyle: { fontWeight: '700', fontSize: 11 },
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            tabBarLabel: 'Home',
            tabBarIcon: ({ color, size }) => <Ionicons name="pulse" size={size} color={color} />,
          }}
        />
        <Tab.Screen
          name="Recommendations"
          component={RecommendationsScreen}
          options={{
            tabBarLabel: 'Recommendations',
            tabBarIcon: ({ color, size }) => <Ionicons name="restaurant-outline" size={size} color={color} />,
          }}
        />
        <Tab.Screen
          name="Events"
          component={EventsScreen}
          options={{
            tabBarLabel: 'Events',
            tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} />,
          }}
        />
      </Tab.Navigator>
      </CgmSessionProvider>
    </NavigationContainer>
  );
}
